/**
 * NordVPN Server Explorer & Browser Latency Tester
 */

const API_URL = 'https://api.nordvpn.com/v1/servers';
const PAGE_SIZE = 24;

let rawServers = [];
let filteredServers = [];
let currentPage = 1;

// Cache ping results by server ID to preserve values across pagination
const pingCache = new Map();

// DOM Elements
let loadingState, errorState, errorMessage, serverContainer, serverGrid, emptyState;
let searchInput, countryFilter, statusFilter, sortBy;
let statTotal, statOnline, statAvgLoad;
let pageStart, pageEnd, totalFiltered, btnPrev, btnNext, pageIndicator;
let modal, modalTitle, modalContent;

// Initialize App when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    bindDOMElements();
    attachEventListeners();
    fetchServers();
});

function bindDOMElements() {
    loadingState = document.getElementById('loadingState');
    errorState = document.getElementById('errorState');
    errorMessage = document.getElementById('errorMessage');
    serverContainer = document.getElementById('serverContainer');
    serverGrid = document.getElementById('serverGrid');
    emptyState = document.getElementById('emptyState');

    searchInput = document.getElementById('searchInput');
    countryFilter = document.getElementById('countryFilter');
    statusFilter = document.getElementById('statusFilter');
    sortBy = document.getElementById('sortBy');

    statTotal = document.getElementById('statTotal');
    statOnline = document.getElementById('statOnline');
    statAvgLoad = document.getElementById('statAvgLoad');

    pageStart = document.getElementById('pageStart');
    pageEnd = document.getElementById('pageEnd');
    totalFiltered = document.getElementById('totalFiltered');
    btnPrev = document.getElementById('btnPrev');
    btnNext = document.getElementById('btnNext');
    pageIndicator = document.getElementById('pageIndicator');

    modal = document.getElementById('modal');
    modalTitle = document.getElementById('modalTitle');
    modalContent = document.getElementById('modalContent');
}

function attachEventListeners() {
    searchInput.addEventListener('input', applyFilters);
    countryFilter.addEventListener('change', applyFilters);
    statusFilter.addEventListener('change', applyFilters);
    sortBy.addEventListener('change', applyFilters);

    document.getElementById('btnPingVisible').addEventListener('click', pingVisibleServers);
    document.getElementById('btnRetry').addEventListener('click', fetchServers);
    document.getElementById('btnCloseModal').addEventListener('click', closeModal);

    btnPrev.addEventListener('click', () => changePage(-1));
    btnNext.addEventListener('click', () => changePage(1));

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

// Fetch NordVPN Server Data
async function fetchServers() {
    loadingState.classList.remove('hidden');
    errorState.classList.add('hidden');
    serverContainer.classList.add('hidden');

    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        rawServers = await response.json();

        populateCountryFilter(rawServers);
        updateGlobalStats(rawServers);
        applyFilters();

        loadingState.classList.add('hidden');
        serverContainer.classList.remove('hidden');
    } catch (err) {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        errorMessage.textContent = err.message || 'Failed to fetch NordVPN servers.';
    }
}

// Browser HTTP Latency Test
async function measureLatency(server) {
    const start = performance.now();
    const targetUrl = `https://${server.hostname}:443`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout

    try {
        await fetch(targetUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const duration = Math.round(performance.now() - start);
        pingCache.set(server.id, duration);
        return duration;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            pingCache.set(server.id, 9999);
            return 9999;
        }
        const duration = Math.round(performance.now() - start);
        pingCache.set(server.id, duration);
        return duration;
    }
}

// Ping Single Server
async function pingSingleServer(serverId) {
    const server = rawServers.find(s => s.id === serverId);
    if (!server) return;

    const badge = document.getElementById(`ping-badge-${serverId}`);
    if (badge) {
        badge.innerHTML = `<span class="animate-pulse text-amber-400">Testing...</span>`;
    }

    const latency = await measureLatency(server);
    updatePingUI(serverId, latency);
}

// Batch Ping All Currently Displayed Servers
async function pingVisibleServers() {
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filteredServers.slice(startIdx, startIdx + PAGE_SIZE);

    pageItems.forEach(server => {
        const badge = document.getElementById(`ping-badge-${server.id}`);
        if (badge) {
            badge.innerHTML = `<span class="animate-pulse text-amber-400">Testing...</span>`;
        }
    });

    await Promise.all(pageItems.map(server => measureLatency(server)));

    if (sortBy.value === 'ping_asc') {
        applyFilters();
    } else {
        renderGrid();
    }
}

function updatePingUI(serverId, latency) {
    const badge = document.getElementById(`ping-badge-${serverId}`);
    if (!badge) return;

    if (latency >= 9999) {
        badge.className = 'font-mono text-red-400 font-semibold';
        badge.textContent = 'Timeout';
    } else if (latency < 100) {
        badge.className = 'font-mono text-emerald-400 font-semibold';
        badge.textContent = `${latency} ms`;
    } else if (latency < 250) {
        badge.className = 'font-mono text-amber-400 font-semibold';
        badge.textContent = `${latency} ms`;
    } else {
        badge.className = 'font-mono text-red-400 font-semibold';
        badge.textContent = `${latency} ms`;
    }
}

// Populate Country Options
function populateCountryFilter(servers) {
    const countries = new Map();
    servers.forEach(s => {
        const country = s.locations?.[0]?.country;
        if (country && !countries.has(country.code)) {
            countries.set(country.code, country.name);
        }
    });

    const sortedCountries = Array.from(countries.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    countryFilter.innerHTML = '<option value="">All Countries</option>';
    
    sortedCountries.forEach(([code, name]) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = name;
        countryFilter.appendChild(opt);
    });
}

// Calculate Stats
function updateGlobalStats(servers) {
    const total = servers.length;
    const online = servers.filter(s => s.status === 'online').length;
    const avgLoad = total > 0 ? Math.round(servers.reduce((acc, s) => acc + (s.load || 0), 0) / total) : 0;

    statTotal.textContent = total.toLocaleString();
    statOnline.textContent = online.toLocaleString();
    statAvgLoad.textContent = `${avgLoad}%`;
}

// Filter and Sort Pipeline
function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const country = countryFilter.value;
    const status = statusFilter.value;
    const sort = sortBy.value;

    filteredServers = rawServers.filter(s => {
        const matchesSearch = !query ||
            s.name.toLowerCase().includes(query) ||
            s.hostname.toLowerCase().includes(query) ||
            s.station.includes(query) ||
            s.locations?.[0]?.country?.name.toLowerCase().includes(query) ||
            s.locations?.[0]?.country?.city?.name.toLowerCase().includes(query);

        const matchesCountry = !country || s.locations?.[0]?.country?.code === country;
        const matchesStatus = !status || s.status === status;

        return matchesSearch && matchesCountry && matchesStatus;
    });

    filteredServers.sort((a, b) => {
        if (sort === 'ping_asc') {
            const pingA = pingCache.has(a.id) ? pingCache.get(a.id) : 99999;
            const pingB = pingCache.has(b.id) ? pingCache.get(b.id) : 99999;
            return pingA - pingB;
        }
        if (sort === 'name_asc') return a.name.localeCompare(b.name);
        if (sort === 'load_asc') return (a.load || 0) - (b.load || 0);
        if (sort === 'load_desc') return (b.load || 0) - (a.load || 0);
        return 0;
    });

    currentPage = 1;
    renderGrid();
}

// Render Server Cards
function renderGrid() {
    serverGrid.innerHTML = '';
    const total = filteredServers.length;

    if (total === 0) {
        emptyState.classList.remove('hidden');
        pageStart.textContent = '0';
        pageEnd.textContent = '0';
        totalFiltered.textContent = '0';
        btnPrev.disabled = true;
        btnNext.disabled = true;
        pageIndicator.textContent = 'Page 0 of 0';
        return;
    }

    emptyState.classList.add('hidden');

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filteredServers.slice(startIdx, startIdx + PAGE_SIZE);

    pageItems.forEach(server => {
        const card = createServerCard(server);
        serverGrid.appendChild(card);
    });

    pageStart.textContent = (startIdx + 1).toLocaleString();
    pageEnd.textContent = Math.min(startIdx + PAGE_SIZE, total).toLocaleString();
    totalFiltered.textContent = total.toLocaleString();

    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage === totalPages;
    pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
}

// Create Card Component
function createServerCard(server) {
    const card = document.createElement('div');
    card.className = 'bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-600 transition flex flex-col justify-between shadow-sm hover:shadow-md';

    const countryName = server.locations?.[0]?.country?.name || 'Unknown Country';
    const cityName = server.locations?.[0]?.country?.city?.name || 'Unknown City';
    const load = server.load || 0;

    let loadColor = 'bg-emerald-500';
    if (load > 60) loadColor = 'bg-amber-500';
    if (load > 85) loadColor = 'bg-red-500';

    const cachedPing = pingCache.get(server.id);

    card.innerHTML = `
        <div>
            <div class="flex items-start justify-between gap-2 mb-3">
                <div>
                    <h3 class="font-bold text-white text-base leading-tight">${server.name}</h3>
                    <p class="text-xs text-slate-400 mt-0.5">${cityName}, ${countryName}</p>
                </div>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${server.status === 'online' ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/30' : 'bg-red-900/40 text-red-400 border border-red-500/30'}">
                    ${server.status}
                </span>
            </div>

            <div class="space-y-2 text-xs text-slate-300 mb-4">
                <div class="flex justify-between items-center">
                    <span class="text-slate-400">IP / Station:</span>
                    <span class="font-mono text-slate-200">${server.station || 'N/A'}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-slate-400">Ping (RTT):</span>
                    <span id="ping-badge-${server.id}" class="font-mono text-slate-400">
                        ${cachedPing !== undefined ? (cachedPing >= 9999 ? '<span class="text-red-400">Timeout</span>' : `${cachedPing} ms`) : 'Unchecked'}
                    </span>
                </div>
            </div>

            <div class="mb-4">
                <div class="flex justify-between text-xs mb-1">
                    <span class="text-slate-400">Server Load</span>
                    <span class="font-semibold text-slate-200">${load}%</span>
                </div>
                <div class="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div class="${loadColor} h-1.5 rounded-full" style="width: ${load}%"></div>
                </div>
            </div>
        </div>

        <div class="flex items-center space-x-2 mt-2">
            <button class="btn-ping flex-1 bg-slate-700/60 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-600/50 text-xs py-2 rounded-lg font-medium transition flex items-center justify-center space-x-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <span>Test Ping</span>
            </button>
            <button class="btn-specs px-3 bg-slate-700/30 hover:bg-slate-700/60 text-slate-300 hover:text-white border border-slate-600/50 text-xs py-2 rounded-lg font-medium transition">
                Specs
            </button>
        </div>
    `;

    // Event listener attachments for dynamic elements
    card.querySelector('.btn-ping').addEventListener('click', () => pingSingleServer(server.id));
    card.querySelector('.btn-specs').addEventListener('click', () => openModal(server.id));

    return card;
}

// Pagination Controls
function changePage(delta) {
    currentPage += delta;
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Details Modal
function openModal(serverId) {
    const server = rawServers.find(s => s.id === serverId);
    if (!server) return;

    modalTitle.textContent = `${server.name} (${server.hostname})`;

    const technologiesList = (server.technologies || []).map(t => `
        <li class="bg-slate-900/60 p-2.5 rounded-lg border border-slate-700">
            <div class="font-semibold text-white text-xs">${t.name} <span class="text-slate-500 font-normal">(${t.identifier})</span></div>
            ${t.pivot?.status ? `<div class="text-[11px] text-emerald-400 mt-0.5">Status: ${t.pivot.status}</div>` : ''}
        </li>
    `).join('');

    modalContent.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
            <div><span class="text-slate-400">ID:</span> <span class="text-white font-mono">${server.id}</span></div>
            <div><span class="text-slate-400">Status:</span> <span class="text-white font-semibold">${server.status}</span></div>
            <div><span class="text-slate-400">Station IP:</span> <span class="text-white font-mono">${server.station}</span></div>
            <div><span class="text-slate-400">Hostname:</span> <span class="text-white font-mono">${server.hostname}</span></div>
            <div><span class="text-slate-400">Load:</span> <span class="text-white">${server.load}%</span></div>
            <div><span class="text-slate-400">Updated:</span> <span class="text-white">${server.updated_at}</span></div>
        </div>

        <div>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Supported Technologies</h4>
            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${technologiesList || '<li class="text-slate-500">None reported</li>'}
            </ul>
        </div>

        <div>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Raw JSON Payload</h4>
            <pre class="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-blue-300 overflow-x-auto font-mono max-h-48">${JSON.stringify(server, null, 2)}</pre>
        </div>
    `;

    modal.classList.remove('hidden');
}

function closeModal() {
    modal.classList.add('hidden');
}
