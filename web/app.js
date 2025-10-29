fetch('/api/info')
    .then(r => r.json())
    .then(info => {
        document.getElementById('repo-name').textContent = info.name;
        document.getElementById('repo-path').textContent = info.path;
    })
    .catch(err => {
        console.error('Error:', err);
    });

fetch('/api/config')
    .then(r => r.json())
    .then(config => {
        //document.getElementById('config').textContent = JSON.stringify(config, null, 2);
    })
    .catch(err => {
        console.error('Error:', err);
        document.getElementById('config').textContent = 'Error loading config';
    });

fetch('/api/graph')
    .then(r => r.json())
    .then(graph => {
        const canvas = document.getElementById('canvas');
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        d3.select('#graph').selectAll('*').remove();
        const svg = d3.select('#graph').attr('width', width).attr('height', height);
        const g = svg.append('g');
        
        const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
        svg.call(zoom);

        const simulation = d3.forceSimulation(graph.nodes)
            .force('link', d3.forceLink(graph.links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(30));

        const link = g.append('g')
            .selectAll('path')
            .data(graph.links)
            .enter()
            .append('path')
            .attr('class', 'link')
            .style('fill', 'none')
            .style('stroke', '#30363d')
            .style('stroke-width', '2px');

        const node = g.append('g')
            .selectAll('g')
            .data(graph.nodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }))
            .on('click', (event, d) => {
                console.log('Clicked node:', d);
            });

        node.append('circle')
            .attr('r', 6)
            .style('fill', d => d.type === 'merge' ? '#a371f7' : '#58a6ff')
            .style('stroke', d => d.type === 'merge' ? '#8957e5' : '#1f6feb')
            .style('stroke-width', '2px')
            .style('cursor', 'pointer');

        node.append('text')
            .attr('dx', 12)
            .attr('dy', 4)
            .text(d => d.hash.substring(0, 7))
            .style('font-family', 'monospace')
            .style('font-size', '11px')
            .style('fill', '#8b949e')
            .style('pointer-events', 'none');
        
        node.filter(d => d.branches && d.branches.length > 0)
            .append('text')
            .attr('dx', 12)
            .attr('dy', -8)
            .text(d => d.branches.join(', '))
            .style('font-size', '11px')
            .style('fill', '#58a6ff')
            .style('font-weight', '600')
            .style('pointer-events', 'none');
        
        simulation.on('tick', () => {
            link.attr('d', d => {
                return 'M' + d.source.x + ',' + d.source.y + 'L' + d.target.x + ',' + d.target.y;
            });
            
            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });
    })
    .catch(err => {
        console.error('Error:', err);
    });
