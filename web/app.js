const canvas = document.getElementById('graphCanvas')
const sidebar = document.getElementById('sidebar')
const main = document.getElementById('main')
const sidebarToggle = document.getElementById('sidebarToggle')
const sidebarRestore = document.getElementById('sidebarRestore')
const sidebarResize = document.getElementById('sidebarResize')
const repoNameEl = document.getElementById('repoName')
const repoPathEl = document.getElementById('repoPath')
const statusBodyEl = document.getElementById('statusBody')

function resizeCanvas() {
    const parent = canvas.parentElement
    const rect = parent.getBoundingClientRect()
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.width = Math.floor(rect.width * dpr)
    canvas.height = Math.floor(rect.height * dpr)
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
}

function getSidebarWidth() {
    const stored = localStorage.getItem('sidebarWidth')
    return stored ? parseInt(stored, 10) : 260
}

function setSidebarWidth(width) {
    const minWidth = 180
    const maxWidth = 500
    const clamped = Math.max(minWidth, Math.min(maxWidth, width))
    document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
    localStorage.setItem('sidebarWidth', clamped.toString())
    resizeCanvas()
}

function toggleSidebar() {
    const isCollapsed = sidebar.classList.contains('collapsed')
    if (isCollapsed) {
        sidebar.classList.remove('collapsed')
        main.classList.remove('collapsed')
    } else {
        sidebar.classList.add('collapsed')
        main.classList.add('collapsed')
    }
    setTimeout(resizeCanvas, 200)
}

let isResizing = false
let startX = 0
let startWidth = 0
let rafId = 0
let queuedWidth = null

function startResize(e) {
    isResizing = true
    startX = e.clientX
    startWidth = getSidebarWidth()
    document.body.classList.add('resizing')
    document.addEventListener('mousemove', doResize)
    document.addEventListener('mouseup', stopResize)
    e.preventDefault()
}

function doResize(e) {
    if (!isResizing) return
    const diff = e.clientX - startX
    queuedWidth = startWidth + diff
    if (!rafId) {
        rafId = requestAnimationFrame(() => {
            if (queuedWidth != null) setSidebarWidth(queuedWidth)
            rafId = 0
            queuedWidth = null
        })
    }
}

function stopResize() {
    isResizing = false
    document.body.classList.remove('resizing')
    document.removeEventListener('mousemove', doResize)
    document.removeEventListener('mouseup', stopResize)
}

setSidebarWidth(getSidebarWidth())
sidebarToggle.addEventListener('click', toggleSidebar)
sidebarRestore.addEventListener('click', toggleSidebar)
sidebarResize.addEventListener('mousedown', startResize)

window.addEventListener('resize', resizeCanvas)
resizeCanvas()

function updateRepositoryInfo(data) {
    if (!data || typeof data !== 'object') return
    
    if (repoNameEl && data.name != null) {
        repoNameEl.textContent = data.name
    }
    if (repoPathEl && data.absPath != null) {
        repoPathEl.textContent = data.absPath
        repoPathEl.title = data.absPath
    }
}

function updateStatus(data) {
    if (!statusBodyEl) return
    
    if (!data || !Array.isArray(data.entries) || data.entries.length === 0) {
        statusBodyEl.innerHTML = '<div style="color:var(--muted)">Working tree clean</div>'
        return
    }
    
    const fragment = document.createDocumentFragment()
    data.entries.forEach(entry => {
        const entryDiv = document.createElement('div')
        entryDiv.className = 'status-entry'
        
        const flagsDiv = document.createElement('div')
        flagsDiv.className = 'status-flags'
        
        if (entry.indexStatus) {
            const indexFlag = document.createElement('div')
            indexFlag.className = 'status-flag index'
            indexFlag.textContent = entry.indexStatus || ' '
            flagsDiv.appendChild(indexFlag)
        }
        
        if (entry.worktreeStatus) {
            const worktreeFlag = document.createElement('div')
            worktreeFlag.className = 'status-flag worktree'
            worktreeFlag.textContent = entry.worktreeStatus || ' '
            flagsDiv.appendChild(worktreeFlag)
        }
        
        const pathDiv = document.createElement('div')
        pathDiv.className = 'status-path'
        pathDiv.textContent = entry.path || ''
        
        entryDiv.appendChild(flagsDiv)
        entryDiv.appendChild(pathDiv)
        fragment.appendChild(entryDiv)
    })
    
    statusBodyEl.innerHTML = ''
    statusBodyEl.appendChild(fragment)
}

async function fetchRepositoryInfo() {
    try {
        const res = await fetch('/api/repository', { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return
        const data = await res.json()
        updateRepositoryInfo(data)
    } catch (_) {
        // ignore for now; page stays with placeholders
    }
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/status', { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return
        const data = await res.json()
        updateStatus(data)
    } catch (_) {
        // ignore for now
    }
}

let ws = null
let reconnectTimeout = null
const reconnectDelay = 2000

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/ws`
    
    ws = new WebSocket(wsUrl)
    
    ws.onopen = () => {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout)
            reconnectTimeout = null
        }
    }
    
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data)
            if (message && message.type === 'repository' && message.data) {
                updateRepositoryInfo(message.data)
            } else if (message && message.type === 'status' && message.data) {
                updateStatus(message.data)
            }
        } catch (err) {
            // Ignore parse errors
        }
    }
    
    ws.onerror = () => {
        // Error handled by onclose
    }
    
    ws.onclose = () => {
        ws = null
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectWebSocket, reconnectDelay)
        }
    }
}

fetchRepositoryInfo()
fetchStatus()
connectWebSocket()
