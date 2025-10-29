fetch('/api/config')
    .then(r => r.json())
    .then(config => {
        console.log('Config:', config);
        document.getElementById('config').textContent = JSON.stringify(config, null, 2);
    })
    .catch(err => {
        console.error('Error:', err);
        document.getElementById('config').textContent = 'Error loading config';
    });
