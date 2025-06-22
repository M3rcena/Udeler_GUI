const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const accessToken = (document.cookie.match(/access_token=([a-zA-Z0-9_.-]+)/) || [])[1];
    const subdomain = window.location.hostname.split('.')[0];
    if (accessToken) {
        ipcRenderer.send('access-token', {
            access_token: accessToken,
            subdomain: subdomain
        });
    }
}); 