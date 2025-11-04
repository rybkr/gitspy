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
let currentNodes = []
let currentLinks = []
let nodeSelection = null
let linkSelection = null

function updatePopupPosition() {
    if (!popupCommit || !popupOverlay?.classList.contains('visible') || !graphContainer) return

    const svgRect = document.getElementById('graphSvg').getBoundingClientRect()
    const containerTransform = d3.zoomTransform(graphContainer.node())
    const nodeX = containerTransform.applyX(popupCommit.x || 0)
    const nodeY = containerTransform.applyY(popupCommit.y || 0)

    const offsetX = 20, offsetY = -10
    let left = svgRect.left + nodeX + offsetX
    let top = svgRect.top + nodeY + offsetY

    const popupRect = popupOverlay.getBoundingClientRect()
    const { innerWidth: viewportWidth, innerHeight: viewportHeight } = window

    if (left + popupRect.width > viewportWidth) left = svgRect.left + nodeX - popupRect.width - offsetX
    if (top + popupRect.height > viewportHeight) top = svgRect.top + nodeY - popupRect.height - offsetY
    if (left < 0) left = 10
    if (top < 0) top = 10

    popupOverlay.style.left = `${left}px`
    popupOverlay.style.top = `${top}px`
}

function resizeGraph() {
    const rect = document.getElementById('graph').getBoundingClientRect()
    svg.attr('width', rect.width).attr('height', rect.height)
    if (simulation) {
        simulation.force('center', d3.forceCenter(rect.width / 2, rect.height / 2))
    }
    updatePopupPosition()
}

function showCommitPopup(commit) {
    if (!commit || !popupOverlay) return

    popupCommit = commit
    popupHash.textContent = commit.hash
    popupMessage.textContent = commit.message || 'No message'
    popupAuthor.textContent = commit.author || 'Unknown author'
    popupDate.textContent = commit.date || 'Unknown date'

    if (commit.branches?.length > 0) {
        popupBranches.textContent = commit.branches.join(', ')
        popupBranches.style.display = 'block'
    } else {
        popupBranches.style.display = 'none'
    }

    popupOverlay.classList.add('visible')
    updatePopupPosition()
}

function getLinePointOnCircle(source, target, radius) {
    const dx = target.x - source.x
    const dy = target.y - source.y
    const length = Math.sqrt(dx * dx + dy * dy)
    if (length === 0) return { x: target.x, y: target.y }

    const norm = radius + 0.5
    return {
        x: target.x - (dx / length) * norm,
        y: target.y - (dy / length) * norm
    }
}

function getLineStartPoint(source, target, radius) {
    const dx = target.x - source.x
    const dy = target.y - source.y
    const length = Math.sqrt(dx * dx + dy * dy)
    if (length === 0) return { x: source.x, y: source.y }

    return {
        x: source.x + (dx / length) * radius,
        y: source.y + (dy / length) * radius
    }
}

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

function getNodeClass(d) {
    let classes = 'node'
    if (d.branches?.length > 0) classes += ' branch'
    if (selectedCommit === d.hash) classes += ' selected'
    return classes
}

function createNodeElement(node) {
    const nodeEl = node.append('g')
        .attr('class', getNodeClass)
        .call(d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended))

    nodeEl.append('circle').attr('r', 6)

    nodeEl.append('text')
        .attr('dy', 20)
        .attr('text-anchor', 'middle')
        .attr('class', 'node-label')
        .text(d => d.hash.substring(0, 7))

    nodeEl.on('click', (event, d) => {
        selectedCommit = d.hash
        nodeSelection.selectAll('g.node').classed('selected', n => n.hash === selectedCommit)
        showCommitPopup(d, event)
        event.stopPropagation()
    })

    return nodeEl
}

function initializeSimulation(width, height) {
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const linkColor = getComputedStyle(document.documentElement).getPropertyValue('--link').trim() || '#ccd2db'
    svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('refX', 5.5)
        .attr('refY', 2)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,0 L0,4 L6,2 z')
        .attr('fill', linkColor)

    graphContainer = svg.append('g').attr('class', 'graph-container')
    linkSelection = graphContainer.append('g').attr('class', 'links')
    nodeSelection = graphContainer.append('g').attr('class', 'nodes')

    simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(32))
        .force('charge', d3.forceManyBody().strength(-128))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(20))

    simulation.on('tick', () => {
        linkSelection.selectAll('line').each(function (d) {
            const startPoint = getLineStartPoint(d.source, d.target, 6)
            const endPoint = getLinePointOnCircle(d.source, d.target, 6)
            d3.select(this)
                .attr('x1', startPoint.x).attr('y1', startPoint.y)
                .attr('x2', endPoint.x).attr('y2', endPoint.y)
        })

        nodeSelection.selectAll('g.node').attr('transform', d => `translate(${d.x},${d.y})`)

        if (popupCommit) {
            const currentCommit = currentNodes.find(n => n.hash === popupCommit.hash)
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
            graphContainer.attr('transform', event.transform)
            updatePopupPosition()
        })

    svg.call(zoom)
    svg.on('click', (event) => {
        if (event.target === svg.node() || event.target.tagName === 'line') {
            hideCommitPopup()
        }
    })
}

function updateGraph(data) {
    if (!data?.nodes || !data.edges) return

    graphData = data
    const rect = document.getElementById('graph').getBoundingClientRect()
    const { width, height } = rect

    const newNodes = data.nodes.map(d => ({
        id: d.hash,
        hash: d.hash,
        branches: d.branches || [],
        message: d.message || '',
        author: d.author || '',
        date: d.date || ''
    }))

    const newLinks = data.edges.map(d => ({
        source: d.source,
        target: d.target
    }))

    if (!simulation) {
        initializeSimulation(width, height)
        currentNodes = newNodes
        currentLinks = newLinks

        linkSelection.selectAll('line')
            .data(currentLinks, d => `${d.source}-${d.target}`)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('marker-end', 'url(#arrowhead)')

        createNodeElement(
            nodeSelection.selectAll('g.node')
                .data(currentNodes, d => d.hash)
                .enter()
        )

        simulation.nodes(currentNodes)
        simulation.force('link').links(currentLinks)
        simulation.alpha(1).restart()
        return
    }

    const existingNodeMap = new Map(currentNodes.map(n => [n.hash, n]))
    const newNodesToAdd = newNodes.filter(newNode => {
        const existing = existingNodeMap.get(newNode.hash)
        if (existing) Object.assign(existing, newNode)
        return !existing
    })

    const existingLinkKeys = new Set(currentLinks.map(l => `${l.source}-${l.target}`))
    const newLinksToAdd = newLinks.filter(l => !existingLinkKeys.has(`${l.source}-${l.target}`))

    if (newNodesToAdd.length > 0 || newLinksToAdd.length > 0) {
        currentNodes.push(...newNodesToAdd)
        currentLinks.push(...newLinksToAdd)

        linkSelection.selectAll('line')
            .data(currentLinks, d => `${d.source}-${d.target}`)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('marker-end', 'url(#arrowhead)')

        if (newNodesToAdd.length > 0) {
            createNodeElement(
                nodeSelection.selectAll('g.node')
                    .data(currentNodes, d => d.hash)
                    .enter()
            )
        }

        nodeSelection.selectAll('g.node')
            .data(currentNodes, d => d.hash)
            .attr('class', getNodeClass)

        simulation.nodes(currentNodes)
        simulation.force('link').links(currentLinks)
        simulation.force('center', d3.forceCenter(width / 2, height / 2))
        simulation.alpha(1).restart()
    }
}

function getSidebarWidth() {
    const stored = localStorage.getItem('sidebarWidth')
    return stored ? parseInt(stored, 10) : 260
}

function setSidebarWidth(width) {
    const clamped = Math.max(180, Math.min(500, width))
    document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
    localStorage.setItem('sidebarWidth', clamped.toString())
    resizeGraph()
}

function toggleSidebar() {
    const isCollapsed = sidebar.classList.contains('collapsed')
    sidebar.classList.toggle('collapsed', !isCollapsed)
    main.classList.toggle('collapsed', !isCollapsed)
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
    queuedWidth = startWidth + (e.clientX - startX)
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
    if (repoNameEl && data.name != null) repoNameEl.textContent = data.name
    if (repoPathEl && data.absPath != null) {
        repoPathEl.textContent = data.absPath
        repoPathEl.title = data.absPath
    }
}

function updateStatus(data) {
    if (!statusBodyEl) return

    if (!data?.entries?.length) {
        statusBodyEl.innerHTML = '<div style="color:var(--muted)">Working tree clean</div>'
        return
    }

    const getStatusClass = status => (status?.toLowerCase() === '?' ? 'untracked' : status?.toLowerCase() || '')
    const fragment = document.createDocumentFragment()

    data.entries.forEach(entry => {
        const entryDiv = document.createElement('div')
        entryDiv.className = 'status-entry'

        const statusFlags = document.createElement('span')
        statusFlags.className = 'status-flags'

        const indexStatus = entry.indexStatus || ' '
        const worktreeStatus = entry.worktreeStatus || ' '

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
        updateRepositoryInfo(await res.json())
    } catch (_) { }
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/status', { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return
        updateStatus(await res.json())
    } catch (_) { }
}

async function fetchGraph() {
    try {
        const res = await fetch('/api/graph', { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return
        updateGraph(await res.json())
    } catch (_) { }
}

let ws = null
let reconnectTimeout = null
const reconnectDelay = 2000

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`)

    ws.onopen = () => {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout)
            reconnectTimeout = null
        }
    }

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data)
            if (message?.type === 'repository' && message.data) {
                updateRepositoryInfo(message.data)
            } else if (message?.type === 'status' && message.data) {
                updateStatus(message.data)
            } else if (message?.type === 'graph' && message.data) {
                updateGraph(message.data)
            }
        } catch (_) { }
    }

    ws.onerror = () => { }

    ws.onclose = () => {
        ws = null
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectWebSocket, reconnectDelay)
        }
    }
}

function hideCommitPopup() {
    if (popupOverlay) popupOverlay.classList.remove('visible')
    popupCommit = null
}

document.addEventListener('click', (e) => {
    if (popupOverlay?.classList.contains('visible') && !popupOverlay.contains(e.target) && e.target !== popupOverlay) {
        hideCommitPopup()
    }
}, true)

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupOverlay?.classList.contains('visible')) {
        hideCommitPopup()
    }
})

fetchRepositoryInfo()
fetchStatus()
fetchGraph()
connectWebSocket()
