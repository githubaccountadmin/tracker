const CONFIG = {
    startingWallet: "0xfD35CFd830ADace105280B33A911C16367EF2337",
    trbContractAddress: "0x88dF592F8eb5D7Bd38bFeF7dEb0fBc02cf3778a0",
    apiUrl: "https://api.scan.pulsechain.com/api/v2",
    batchSize: 50, maxDepth: 3
};

let root, svg, g, zoom, walletNames = new Map(), allTransactions = [], filteredTransactions = [];

const main = async () => {
    loadStoredData();
    setupSvg();
    await updateVisualization();
    setupEventListeners();
    setInterval(updateVisualization, 60000);
};

const loadStoredData = () => {
    const load = (key, def) => JSON.parse(localStorage.getItem(key) || JSON.stringify(def));
    walletNames = new Map(load('walletNames', []));
    CONFIG.maxDepth = load('maxDepth', 3);
    document.getElementById('max-depth').value = CONFIG.maxDepth;
    document.documentElement.className = load('theme', 'dark');
};

const saveStoredData = () => {
    localStorage.setItem('walletNames', JSON.stringify([...walletNames]));
    localStorage.setItem('maxDepth', CONFIG.maxDepth);
    localStorage.setItem('theme', document.documentElement.className);
};

const setupSvg = () => {
    const {clientWidth: width, clientHeight: height} = document.getElementById('tree-container');
    svg = d3.select("#tree-container").append("svg").attr("width", width).attr("height", height);
    g = svg.append("g");
    zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);
};

const updateVisualization = async () => {
    try {
        document.querySelector('.loading').style.display = 'block';
        const data = await fetchWalletDataRecursive(CONFIG.startingWallet);
        root = d3.hierarchy(data);
        createTreeVisualization(root);
        filteredTransactions = [...allTransactions];
        updateAnalytics();
    } catch (error) {
        console.error("Error updating visualization:", error);
    } finally {
        document.querySelector('.loading').style.display = 'none';
    }
};

const fetchWalletDataRecursive = async (wallet, depth = 0) => {
    if (depth >= CONFIG.maxDepth) return { address: wallet, balance: "Max depth", children: [] };
    try {
        const response = await fetch(`${CONFIG.apiUrl}/addresses/${CONFIG.trbContractAddress}/transactions?filter=to&sort=desc&limit=${CONFIG.batchSize}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const processedData = processTransactions(wallet, data.items);
        allTransactions.push(...processedData.children);
        processedData.children = await Promise.all(processedData.children.map(child => fetchWalletDataRecursive(child.address, depth + 1)));
        return processedData;
    } catch (error) {
        console.error("Error fetching wallet data:", error);
        return { address: wallet, balance: "Error", children: [] };
    }
};

const processTransactions = (wallet, transactions) => {
    let balance = 0;
    const children = transactions.reduce((acc, tx) => {
        if (tx.to.toLowerCase() === wallet.toLowerCase()) balance += parseFloat(tx.value);
        else if (tx.from.toLowerCase() === wallet.toLowerCase()) {
            balance -= parseFloat(tx.value);
            acc.push({ address: tx.to, value: tx.value, date: new Date(tx.timestamp * 1000).toLocaleString(), children: [] });
        }
        return acc;
    }, []);
    return { address: wallet, balance: balance.toFixed(2), children };
};

const createTreeVisualization = (root) => {
    const {clientWidth: width, clientHeight: height} = document.getElementById('tree-container');
    g.selectAll("*").remove();
    const tree = d3.tree().size([height, width - 160]);
    tree(root);
    g.selectAll(".link").data(root.links()).enter().append("path")
        .attr("class", "link").attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));
    const node = g.selectAll(".node").data(root.descendants()).enter().append("g")
        .attr("class", d => "node" + (d.children ? " node--internal" : " node--leaf"))
        .attr("transform", d => `translate(${d.y},${d.x})`);
    node.append("circle").attr("r", 10);
    node.append("text").attr("dy", ".35em").attr("x", d => d.children ? -13 : 13)
        .style("text-anchor", d => d.children ? "end" : "start")
        .text(d => walletNames.get(d.data.address) || d.data.address.slice(0, 10) + "...");
    node.append("title").text(d => `Address: ${d.data.address}\nBalance: ${d.data.balance}\nLast Transaction: ${d.data.children[0]?.date || 'N/A'}`);
    node.on("click", (event, d) => showWalletDetails(d.data));
    const rootNode = root.descendants()[0];
    const scale = 0.8;
    g.transition().call(zoom.transform, d3.zoomIdentity.translate(-rootNode.y * scale + width / 4, -rootNode.x * scale + height / 2).scale(scale));
};

const showWalletDetails = (data) => {
    const name = walletNames.get(data.address) || 'Unnamed';
    document.getElementById('wallet-details').innerHTML = `
        <h3>${name} (${data.address.slice(0, 10)}...)</h3>
        <p>Balance: ${data.balance} TRB</p>
        <p>Transaction History:</p>
        <ul>${data.children.map(tx => `<li>To: ${tx.address.slice(0, 10)}... Amount: ${tx.value} TRB Date: ${tx.date}</li>`).join('')}</ul>
        <input type="text" id="wallet-name-input" placeholder="Enter wallet name">
        <button onclick="setWalletName('${data.address}')">Set Name</button>
    `;
};

const setWalletName = (address) => {
    const name = document.getElementById('wallet-name-input').value.trim();
    if (name) {
        walletNames.set(address, name);
        saveStoredData();
        updateVisualization();
    }
};

const setupEventListeners = () => {
    const on = (id, event, handler) => document.getElementById(id).addEventListener(event, handler);
    on('update-depth', 'click', async () => {
        CONFIG.maxDepth = parseInt(document.getElementById('max-depth').value);
        saveStoredData();
        await updateVisualization();
    });
    on('refresh-data', 'click', updateVisualization);
    on('toggle-theme', 'click', () => {
        document.documentElement.classList.toggle('light');
        saveStoredData();
    });
    on('apply-filters', 'click', applyFilters);
};

const applyFilters = () => {
    const dateFrom = new Date(document.getElementById('date-from').value);
    const dateTo = new Date(document.getElementById('date-to').value);
    const amountMin = parseFloat(document.getElementById('amount-min').value) || 0;
    const amountMax = parseFloat(document.getElementById('amount-max').value) || Infinity;
    filteredTransactions = allTransactions.filter(tx => {
        const txDate = new Date(tx.date);
        const txAmount = parseFloat(tx.value);
        return txDate >= dateFrom && txDate <= dateTo && txAmount >= amountMin && txAmount <= amountMax;
    });
    updateVisualization();
};

const updateAnalytics = () => {
    const totalTx = filteredTransactions.length;
    const totalVolume = filteredTransactions.reduce((sum, tx) => sum + parseFloat(tx.value), 0);
    const avgTx = totalVolume / totalTx || 0;
    const update = (id, value) => document.getElementById(id).textContent = value;
    update('total-transactions', totalTx);
    update('total-volume', totalVolume.toFixed(2));
    update('avg-transaction', avgTx.toFixed(2));
};

main();
