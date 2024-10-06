const CONFIG = {
    startingWallet: "0xfD35CFd830ADace105280B33A911C16367EF2337",
    trbContractAddress: "0x88dF592F8eb5D7Bd38bFeF7dEb0fBc02cf3778a0",
    apiUrl: "https://api.scan.pulsechain.com/api/v2",
    rpcUrl: "https://rpc.pulsechain.com",
    chainId: 369,
    batchSize: 50,
    maxDepth: 3
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
    const load = (key, def) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : def;
        } catch (e) {
            console.error(`Error loading ${key} from localStorage:`, e);
            return def;
        }
    };
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
        createForceDirectedVisualization(root);
        filteredTransactions = [...allTransactions];
        updateAnalytics();
    } catch (error) {
        console.error("Error updating visualization:", error);
        showError("Error updating visualization: " + error.message);
    } finally {
        document.querySelector('.loading').style.display = 'none';
    }
};

const fetchWalletDataRecursive = async (wallet, depth = 0) => {
    if (depth >= CONFIG.maxDepth) return { address: wallet, balance: "Max depth", children: [], transactions: [] };
    try {
        const response = await fetch(`${CONFIG.apiUrl}/addresses/${wallet}/transactions?filter=to%20%7C%20from&limit=${CONFIG.batchSize}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const processedData = processTransactions(wallet, data.items || []);
        allTransactions.push(...processedData.transactions);
        processedData.children = await Promise.all(processedData.children.map(child => fetchWalletDataRecursive(child.address, depth + 1)));
        return processedData;
    } catch (error) {
        console.error("Error fetching wallet data:", error);
        return { address: wallet, balance: "Error", children: [], transactions: [] };
    }
};

const processTransactions = (wallet, transactions) => {
    let balance = 0;
    const children = new Map();
    const processedTransactions = [];

    transactions.forEach(tx => {
        if (typeof tx !== 'object' || tx === null) return;
        const toAddress = String(tx.to).toLowerCase();
        const fromAddress = String(tx.from).toLowerCase();
        const walletAddress = wallet.toLowerCase();
        const value = parseFloat(tx.value || 0);
        
        if (toAddress === walletAddress) {
            balance += value;
        } else if (fromAddress === walletAddress) {
            balance -= value;
            if (!children.has(toAddress)) {
                children.set(toAddress, { address: toAddress, value: 0, children: [], transactions: [] });
            }
            children.get(toAddress).value += value;
        }

        processedTransactions.push({
            from: fromAddress,
            to: toAddress,
            value,
            date: new Date(parseInt(tx.timestamp) * 1000).toLocaleString()
        });
    });

    return { 
        address: wallet, 
        balance: balance.toFixed(2), 
        children: Array.from(children.values()),
        transactions: processedTransactions
    };
};

const createForceDirectedVisualization = (root) => {
    const {clientWidth: width, clientHeight: height} = document.getElementById('tree-container');
    g.selectAll("*").remove();

    const nodes = root.descendants();
    const links = root.links();

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.data.address).distance(100))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2));

    const link = g.selectAll(".link")
        .data(links)
        .enter().append("line")
        .attr("class", "link")
        .attr("marker-end", "url(#arrowhead)");

    const node = g.selectAll(".node")
        .data(nodes)
        .enter().append("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    node.append("circle")
        .attr("r", d => Math.sqrt(Math.abs(parseFloat(d.data.balance)) || 1) * 5)
        .style("fill", d => d3.schemeCategory10[d.depth % 10]);

    node.append("text")
        .attr("dy", ".3em")
        .style("text-anchor", "middle")
        .text(d => {
            const name = walletNames.get(d.data.address) || d.data.address.slice(0, 10) + "...";
            return d.r > 20 ? name : '';
        });

    node.append("title")
        .text(d => `Address: ${d.data.address}\nBalance: ${d.data.balance}\nLast Transaction: ${d.data.transactions[0]?.date || 'N/A'}`);

    node.on("click", (event, d) => showWalletDetails(d.data));

    // Add arrowhead marker
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 15)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("class", "arrowhead");

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
};

const showWalletDetails = (data) => {
    const name = walletNames.get(data.address) || 'Unnamed';
    document.getElementById('wallet-details').innerHTML = `
        <h3>${name} (${data.address.slice(0, 10)}...)</h3>
        <p>Balance: ${data.balance} TRB</p>
        <p>Transaction History:</p>
        <ul>${data.transactions.map(tx => `<li>From: ${tx.from.slice(0, 10)}... To: ${tx.to.slice(0, 10)}... Amount: ${tx.value} TRB Date: ${tx.date}</li>`).join('')}</ul>
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

const showError = (message) => {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
};

main();
