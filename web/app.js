const svg = d3.select('#graphSvg')
const sidebar = document.getElementById('sidebar')
const main = document.getElementById('main')
const sidebarToggle = document.getElementById('sidebarToggle')
const sidebarRestore = document.getElementById('sidebarRestore')
const sidebarResize = document.getElementById('sidebarResize')
const repoNameEl = document.getElementById('repoName')
const repoPathEl = document.getElementById('repoPath')
const statusBodyEl = document.getElementById('statusBody')
const popupOverlay = document.getElementById('commitPopup')
const popupHash = document.getElementById('popupHash')
const popupBranches = document.getElementById('popupBranches')
const popupMessage = document.getElementById('popupMessage')
const popupAuthor = document.getElementById('popupAuthor')
const popupDate = document.getElementById('popupDate')

let graphData = null
let simulation = null
let selectedCommit = null
let popupCommit = null
let graphContainer = null

function updatePopupPosition() {
    if (!popupCommit || !popupOverlay || !popupOverlay.classList.contains('visible') || !graphContainer) return

    const svgRect = document.getElementById('graphSvg').getBoundingClientRect()
    const containerTransform = d3.zoomTransform(graphContainer.node())
    const nodeX = containerTransform.applyX(popupCommit.x || 0)
    const nodeY = containerTransform.applyY(popupCommit.y || 0)

    const offsetX = 20
    const offsetY = -10

    let left = svgRect.left + nodeX + offsetX
    let top = svgRect.top + nodeY + offsetY

    const popupRect = popupOverlay.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    if (left + popupRect.width > viewportWidth) {
        left = svgRect.left + nodeX - popupRect.width - offsetX
    }
    if (top + popupRect.height > viewportHeight) {
        top = svgRect.top + nodeY - popupRect.height - offsetY
    }
    if (left < 0) left = 10
    if (top < 0) top = 10

    popupOverlay.style.left = `${left}px`
    popupOverlay.style.top = `${top}px`
}

function resizeGraph() {
    const graphSection = document.getElementById('graph')
    const rect = graphSection.getBoundingClientRect()
    svg.attr('width', rect.width).attr('height', rect.height)
    if (simulation) {
        simulation.force('center', d3.forceCenter(rect.width / 2, rect.height / 2))
    }
    updatePopupPosition()
}

function updateGraph(data) {
    if (!data || !data.nodes || !data.edges) return

    graphData = data

    const graphSection = document.getElementById('graph')
    const rect = graphSection.getBoundingClientRect()
    const width = rect.width
    const height = rect.height

    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const defs = svg.append('defs')
    const arrowMarker = defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('refX', 5.5)
        .attr('refY', 2)
        .attr('orient', 'auto')

    const linkColor = getComputedStyle(document.documentElement).getPropertyValue('--link').trim() || '#ccd2db'
    arrowMarker.append('path')
        .attr('d', 'M0,0 L0,4 L6,2 z')
        .attr('fill', linkColor)

    graphContainer = svg.append('g').attr('class', 'graph-container')
    const container = graphContainer

    const nodes = data.nodes.map(d => ({
        id: d.hash,
        hash: d.hash,
        branches: d.branches || [],
        message: d.message || '',
        author: d.author || '',
        date: d.date || ''
    }))

    const links = data.edges.map(d => ({
        source: d.source,
        target: d.target
    }))

    const link = container.append('g')
        .attr('class', 'links')
        .selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('class', 'link')
        .attr('marker-end', 'url(#arrowhead)')

    const node = container.append('g')
        .attr('class', 'nodes')
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', d => {
            let classes = 'node'
            if (d.branches && d.branches.length > 0) classes += ' branch'
            if (selectedCommit === d.hash) classes += ' selected'
            return classes
        })
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended))

    node.append('circle')
        .attr('r', 6)

    node.append('text')
        .attr('dy', 20)
        .attr('text-anchor', 'middle')
        .attr('class', 'node-label')
        .text(d => d.hash.substring(0, 7))

    function showCommitPopup(commit, event) {
        if (!commit || !popupOverlay) return

        popupCommit = commit
        popupHash.textContent = commit.hash
        popupMessage.textContent = commit.message || 'No message'
        popupAuthor.textContent = commit.author || 'Unknown author'
        popupDate.textContent = commit.date || 'Unknown date'

        if (commit.branches && commit.branches.length > 0) {
            popupBranches.textContent = commit.branches.join(', ')
            popupBranches.style.display = 'block'
        } else {
            popupBranches.style.display = 'none'
        }

        popupOverlay.classList.add('visible')
        updatePopupPosition()
    }

    node.on('click', (event, d) => {
        selectedCommit = d.hash
        node.classed('selected', n => n.hash === selectedCommit)
        showCommitPopup(d, event)
        event.stopPropagation()
    })


    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(32))
        .force('charge', d3.forceManyBody().strength(-128))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(20))

    function getLinePointOnCircle(source, target, radius) {
        const dx = target.x - source.x
        const dy = target.y - source.y
        const length = Math.sqrt(dx * dx + dy * dy)
        if (length === 0) return { x: target.x, y: target.y }

        const dxNorm = dx / length
        const dyNorm = dy / length

        const arrowTipOffset = 0.5
        return {
            x: target.x - dxNorm * (radius + arrowTipOffset),
            y: target.y - dyNorm * (radius + arrowTipOffset)
        }
    }

    function getLineStartPoint(source, target, radius) {
        const dx = target.x - source.x
        const dy = target.y - source.y
        const length = Math.sqrt(dx * dx + dy * dy)
        if (length === 0) return { x: source.x, y: source.y }

        const dxNorm = dx / length
        const dyNorm = dy / length

        return {
            x: source.x + dxNorm * radius,
            y: source.y + dyNorm * radius
        }
    }

    simulation.on('tick', () => {
        link.each(function (d) {
            const startPoint = getLineStartPoint(d.source, d.target, 6)
            const endPoint = getLinePointOnCircle(d.source, d.target, 6)
            d3.select(this)
                .attr('x1', startPoint.x)
                .attr('y1', startPoint.y)
                .attr('x2', endPoint.x)
                .attr('y2', endPoint.y)
        })

        node.attr('transform', d => `translate(${d.x},${d.y})`)

        if (popupCommit) {
            const currentCommit = nodes.find(n => n.hash === popupCommit.hash)
            if (currentCommit) {
                popupCommit.x = currentCommit.x
                popupCommit.y = currentCommit.y
                updatePopupPosition()
            }
        }
    })

    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            container.attr('transform', event.transform)
            updatePopupPosition()
        })

    svg.call(zoom)

    svg.on('click', (event) => {
        if (event.target === svg.node() || event.target.tagName === 'line') {
            hideCommitPopup()
        }
    })

    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        event.subject.fx = event.subject.x
        event.subject.fy = event.subject.y
    }

    function dragged(event) {
        event.subject.fx = event.x
        event.subject.fy = event.y
    }

    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0)
        event.subject.fx = null
        event.subject.fy = null
    }
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
    resizeGraph()
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
    setTimeout(resizeGraph, 200)
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

window.addEventListener('resize', resizeGraph)
resizeGraph()

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

        const indexStatus = entry.indexStatus || ' '
        const worktreeStatus = entry.worktreeStatus || ' '

        const statusFlags = document.createElement('span')
        statusFlags.className = 'status-flags'

        const getStatusClass = (status) => {
            const s = status.toLowerCase()
            return s === '?' ? 'untracked' : s
        }

        const indexSpan = document.createElement('span')
        indexSpan.className = `status-char index status-${getStatusClass(indexStatus)}`
        indexSpan.textContent = indexStatus
        statusFlags.appendChild(indexSpan)

        const worktreeSpan = document.createElement('span')
        worktreeSpan.className = `status-char worktree status-${getStatusClass(worktreeStatus)}`
        worktreeSpan.textContent = worktreeStatus
        statusFlags.appendChild(worktreeSpan)

        const pathSpan = document.createElement('span')
        pathSpan.className = 'status-path'
        pathSpan.textContent = entry.path || ''

        entryDiv.appendChild(statusFlags)
        entryDiv.appendChild(pathSpan)
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

async function fetchGraph() {
    try {
        const res = await fetch('/api/graph', { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return
        const data = await res.json()
        updateGraph(data)
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
            } else if (message && message.type === 'graph' && message.data) {
                updateGraph(message.data)
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

function hideCommitPopup() {
    if (popupOverlay) {
        popupOverlay.classList.remove('visible')
    }
    popupCommit = null
}

document.addEventListener('click', (e) => {
    if (popupOverlay && popupOverlay.classList.contains('visible')) {
        const target = e.target
        if (!popupOverlay.contains(target) && target !== popupOverlay) {
            hideCommitPopup()
        }
    }
}, true)

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupOverlay && popupOverlay.classList.contains('visible')) {
        hideCommitPopup()
    }
})

fetchRepositoryInfo()
fetchStatus()
fetchGraph()
connectWebSocket()