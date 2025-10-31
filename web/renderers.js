//
// Utility functions and classes for rendering various UI components
//
class StatusRenderer {
    constructor() {
        this.stagedList = document.querySelector('.file-list.staged');
        this.dirtyList = document.querySelector('.file-list.dirty');
    }

    render(status) {
        this.renderStaged(status.staged);
        this.renderDirty(status);
    }

    renderStaged(staged) {
        if (!this.stagedList) return;

        const normalized = this.normalizeStaged(staged);
        const filtered = normalized.filter(e => this.isDirtyStaged(e.status));

        let html = '';
        if (filtered.length) {
            html = filtered.map(e => this.renderStagedItem(e)).join('');
        } else {
            html = '<li class="file-item untracked"><span class="dot"></span><span class="name">No staged changes</span><span class="badge">✓</span></li>';
        }

        this.stagedList.innerHTML = html;
    }

    renderDirty(status) {
        if (!this.dirtyList) return;

        let html = '';

        if (Array.isArray(status.modified) && status.modified.length) {
            html += status.modified.map(n => this.renderFileItem(this.entryPath(n), 'modified', 'M')).join('');
        }

        if (Array.isArray(status.deleted) && status.deleted.length) {
            html += status.deleted.map(n => this.renderFileItem(this.entryPath(n), 'deleted', 'D')).join('');
        }

        if (Array.isArray(status.untracked) && status.untracked.length) {
            html += status.untracked.map(n => this.renderFileItem(this.entryPath(n), 'untracked', '?')).join('');
        }

        if (!html) {
            html = '<li class="file-item untracked"><span class="dot"></span><span class="name">Clean working tree</span><span class="badge">✓</span></li>';
        }

        this.dirtyList.innerHTML = html;
    }

    renderStagedItem(entry) {
        const code = ((entry.status || 'M')).toString().toUpperCase();
        let variant = 'modified';
        let badge = 'M';

        if (code.includes('A')) { variant = 'added'; badge = 'A'; }
        else if (code.includes('M')) { variant = 'modified'; badge = 'M'; }
        else if (code.includes('D')) { variant = 'deleted'; badge = 'D'; }
        else if (code.includes('R')) { variant = 'modified'; badge = 'R'; }
        else if (code.includes('C')) { variant = 'modified'; badge = 'C'; }

        return this.renderFileItem(entry.path, variant, badge);
    }

    renderFileItem(path, variant, badge) {
        return `<li class="file-item ${variant}"><span class="dot"></span><span class="name">${this.escapeHtml(path)}</span><span class="badge">${badge}</span></li>`;
    }

    normalizeStaged(raw) {
        if (!raw) return [];
        return raw.map(item => {
            if (typeof item === 'string') {
                return { path: item, status: null };
            }
            if (item && typeof item === 'object') {
                const path = item.path || item.file || item.name || item.newPath || item.oldPath || '';
                const code = item.status || item.code || item.x || item.y || item.xy || null;
                return { path, status: code };
            }
            return null;
        }).filter(Boolean);
    }

    isDirtyStaged(statusCode) {
        if (!statusCode) return true;
        const s = String(statusCode).toUpperCase();
        const has = (ch) => s.includes(ch);
        return has('A') || has('M') || has('D') || has('R') || has('C');
    }

    entryPath(entry) {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';
        return entry.path || entry.file || entry.name || entry.newPath || entry.oldPath || '';
    }

    escapeHtml(text) {
        return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

class ConfigRenderer {
    constructor() {
        this.container = document.getElementById('config-list');
    }

    render(config) {
        if (!this.container) return;

        try {
            const normalized = this.normalizeConfig(config);
            const parsed = this.parseIniIfNeeded(normalized);
            const html = this.buildHtml(parsed);
            this.container.innerHTML = html;
        } catch (err) {
            this.container.innerHTML = '<div class="kv-item"><div class="kv-key">Error</div><div class="kv-value">Failed to load config</div></div>';
        }
    }

    normalizeConfig(config) {
        if (typeof config === 'string') {
            return config;
        }
        if (config && typeof config === 'object') {
            const keys = Object.keys(config);
            if (keys.length === 1 && typeof config[keys[0]] === 'string') {
                return config[keys[0]];
            }
        }
        return config;
    }

    parseIniIfNeeded(config) {
        if (typeof config === 'string') {
            if (/\n|\r|\[.+\]/.test(config)) {
                return this.parseIni(config);
            }
            return config;
        }
        return config;
    }

    parseIni(str) {
        const result = {};
        let section = null;
        const lines = String(str).split(/\r?\n/);

        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#') || line.startsWith(';')) continue;

            const sec = line.match(/^\[(.+?)\]$/);
            if (sec) {
                section = sec[1];
                if (!result[section]) result[section] = {};
                continue;
            }

            const kv = line.match(/^([^=\s]+)\s*=\s*(.*)$/) || line.match(/^([^\s]+)\s+(.*)$/);
            if (kv) {
                const key = kv[1];
                const val = kv[2];
                const target = section ? (result[section] || (result[section] = {})) : (result._ || (result._ = {}));
                
                if (key in target) {
                    const prev = target[key];
                    if (Array.isArray(prev)) {
                        target[key] = prev.concat([val]);
                    } else {
                        target[key] = [prev, val];
                    }
                } else {
                    target[key] = val;
                }
            }
        }

        return result;
    }

    buildHtml(config) {
        if (!this.isPlainObject(config)) {
            return `<div class="kv-item"><div class="kv-key">config</div><div class="kv-value">${this.escapeHtml(config)}</div></div>`;
        }

        let html = '';
        const topKeys = Object.keys(config).sort();

        for (const k of topKeys) {
            const v = config[k];
            
            if (this.isPlainObject(v)) {
                html += '<div class="kv-group">';
                html += `<div class="kv-group-title">[${this.escapeHtml(k)}]</div>`;
                const innerKeys = Object.keys(v).sort();
                for (const ik of innerKeys) {
                    const val = v[ik];
                    if (Array.isArray(val)) {
                        for (const item of val) {
                            html += this.renderKV(ik, item);
                        }
                    } else {
                        html += this.renderKV(ik, val);
                    }
                }
                html += '</div>';
            } else if (Array.isArray(v)) {
                html += '<div class="kv-group">';
                html += `<div class="kv-group-title">[${this.escapeHtml(k)}]</div>`;
                for (const item of v) {
                    if (this.isPlainObject(item)) {
                        const subKeys = Object.keys(item).sort();
                        for (const sk of subKeys) {
                            html += this.renderKV(sk, item[sk]);
                        }
                    } else {
                        html += this.renderKV(k, item);
                    }
                }
                html += '</div>';
            } else {
                html += this.renderKV(k, v);
            }
        }

        return html;
    }

    renderKV(key, value) {
        return `<div class="kv-item"><div class="kv-key">${this.escapeHtml(key)}</div><div class="kv-value">${this.escapeHtml(value)}</div></div>`;
    }

    isPlainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v);
    }

    escapeHtml(text) {
        return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
