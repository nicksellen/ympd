function start() {

    const state = {
        initial: true,
        transport: {
            state: 'unknown', // play|pause|stop|unknown
            elapsedTime: null,
            totalTime: null
        },
        current: {
            album: null,
            artist: null,
            pos: null,
            title: null,
        },
        queue: [],
        browse: {
            pending: false,
            prefix: '/',
            entries: [],
        },
    }

    Object.assign(window, {
        browse(prefix) {
            state.browse.pending = true
            state.browse.prefix = decodeURIComponent(prefix)
            render(state)
            socket.send(`MPD_API_GET_BROWSE,0,${state.browse.prefix}`)
        },
        
        addTrack(uri) {
            socket.send(`MPD_API_ADD_TRACK,${decodeURIComponent(uri)}`)
        },
        
        removeTrack(trackId) {
            socket.send(`MPD_API_RM_TRACK,${trackId}`)
        },
    })

    connect(state)
}

function connect(state) {

    const websocketUrl = document.URL.replace(/^http/, 'ws')

    const socket = new WebSocket(websocketUrl);

    window.socket = socket

    socket.addEventListener('open', () => {
        if (state.initial) {
            browse('/')
            state.initial = false
        }
    })

    let lastState = null

    socket.addEventListener('message', message => {
        if (message.data === lastState || message.data.length == 0) {
            console.log('not processing message!', message)
            return
        }
        // it sometimes has a \u0000 in the data, we can split on that and handle each message...
        // it still breaks sometimes, some bugs in the backend...
        for (const item of message.data.split('\u0000')) {
            try {
                handleMessage(state, JSON.parse(item))
            } catch (err) {
                console.error('JSON exception', err)
                console.log(item)
                console.log(message.data)
                window.errordata = message.data
            }
        }
    })
}

function handleMessage(state, { type, data }) {
    switch (type) {
        case 'queue':
            state.queue = data
            render(state)
            break;
        case 'browse':
            // TODO: make sure we are on the current browse prefix somehow
            state.browse.pending = false
            state.browse.entries = data
            break;
        case 'state':
            const { songpos, elapsedTime, totalTime } = data
            Object.assign(state.transport, {
                songpos,
                elapsedTime,
                totalTime,
                state: getStateName(data.state),
            })
            render(state)
            break;
        case 'update_queue':
            socket.send('MPD_API_GET_QUEUE,0');
            break;
        case 'song_change':
            Object.assign(state.current, data)
            render(state)
            break;

        // not implemented
        case 'search':
        case 'outputnames':
        case 'outputs':
        case 'disconnected':
        default:
            break;
    }
}

function getStateName(stateId) {
    switch (stateId) {
        case 1: return 'stop';
        case 2: return 'play';
        case 3: return 'pause';
        default:
            throw new Error(`unknown state ${stateId}`)
    }
}

function isCurrent(state, track) {
    for (let field of ['artist', 'album', 'title']) {
        if (track[field] !== state.current[field]) {
            return false
        }
    }
    return track.pos === state.transport.songpos
}

function renderQueue(state) {
    const isPlaying = state.transport.state === 'play'

    return `
        <div id="queue" class="queue">
            <ul>
                ${state.queue.map(track => {
                    const isCurrentAndPlaying = isPlaying && isCurrent(state, track)
                    const classes = ['queue-entry']
                    if (isCurrentAndPlaying) {
                        classes.push('current')
                    }
                    function getProgressPercentage() {
                        if (!isCurrentAndPlaying) return 0
                        return Math.round((state.transport.elapsedTime / state.transport.totalTime) * 100)
                    }
                    return `
                        <li class="${classes.join(' ')}">
                            <span class="queue-entry-title">${escape(track.title)}</span>
                            <span class="queue-entry-album">${escape(track.album)}</span>
                            <span class="queue-entry-artist">${escape(track.artist)}</span>
                            ${!isCurrentAndPlaying ? `
                                <span class="queue-entry-duration">${formatSeconds(track.duration)}</span>
                                <span class="queue-entry-remove"><button onclick="removeTrack(${track.id})">remove</button></span>
                            ` : ''}
                            ${isCurrentAndPlaying ? `
                                <span class="queue-entry-time">
                                  ${formatSeconds(state.transport.elapsedTime)} /
                                  ${formatSeconds(state.transport.totalTime)}
                                </span>
                                <span class="queue-entry-progress">
                                    <span
                                      class="queue-entry-progress-bar"
                                      style="width: ${getProgressPercentage()}%">
                                    </span>
                                </span>
                            ` : ''}
                        </li>
                    `
                }).join('')}
            </ul>
        </div>
    `
}

function renderBrowseNav(state) {

    let entries = []

    const parts = state.browse.prefix === '/' ? [] : state.browse.prefix.split('/')

    if (parts.length > 0) {
        entries.push({
            name: 'top',
            prefix: '/',
        })
    } else {
        entries.push({
            name: 'top'
        })
    }

    function getPrefix(parts, index) {
        let s = ''
        for (let i = 0; i <= index; i++) {
            s += parts[i]
        }
        return s
    }

    for (let i = 0; i < parts.length; i++) {
        const name = parts[i]
        if (i < parts.length - 1) {
            entries.push({ name, prefix: getPrefix(parts, i) })
        } else {
            entries.push({ name })
        }
    }

    return `
        <div class="browse-nav">
            <ul>
                ${entries.map(entry => {
                    if (entry.prefix) {
                        return `
                            <li>
                                <a onclick='browse(${encodeParam(entry.prefix)})'>${escape(entry.name)}</a>
                            </li>
                        `
                    } else {
                        return `
                            <li>${escape(entry.name)}</li>
                        `
                    }
                }).join('')}
            </ul>
        </div>
    `
}

function encodeParam(str) {
  return JSON.stringify(encodeURIComponent(str)).replace(/'/g, '&#39;')
}

function renderBrowseEntries(state) {
    return `
        <div class="browse-entries">
            <ul>
                ${state.browse.entries.filter(entry => entry.type === 'directory' || entry.type === 'song').map(entry => {
                    if (entry.type === 'song') {
                        return `
                            <li>
                                <span class="browse-song">
                                    <span class="browse-song-title">${escape(entry.title)}</span>
                                    <span class="browse-song-duration">${formatSeconds(entry.duration)}</span>
                                    <span class="browse-song-add"><button onclick='addTrack(${encodeParam(entry.uri)})'>add</button></span>
                                </span>
                            </li>
                        `
                    } else if (entry.type === 'directory') {
                        const parts = entry.dir.split('/')
                        const name = parts[parts.length - 1]
                        return `
                            <li>
                                <a onclick='browse(${encodeParam(entry.dir)})'>${escape(name)}</a>
                            </li>
                        `
                    }
                }).join('')}
            </ul>
        </div>
    `
}

function renderPending(message) {
    return `<div class="pending"><div></div><div></div><div></div></div>`
}

function renderBrowse(state) {
    return `
        <div id="browse" class="browse">
            ${renderBrowseNav(state)}
            ${state.browse.pending ? renderPending('Fetching entries') : renderBrowseEntries(state)}
        </div>
    `
}

function preserveScroll(ids, fn) {
    const scrollTops = ids.map(id => {
        const el = document.getElementById(id)
        if (!el) return null
        return { id, scrollTop: el.scrollTop }
    }).filter(item => Boolean(item))
    fn()
    for (const { id, scrollTop } of scrollTops) {
        const el = document.getElementById(id)
        if (el) {
            el.scrollTop = scrollTop
        }
    }

}

function render(state) {
    const el = document.getElementById('app')

    const classes = []

    classes.push(`transport-state-${state.transport.state}`)

    const html = `
        <div class="main ${classes.join(' ')}">
            ${renderQueue(state)}
            ${renderBrowse(state)}
        </div>
    `

    preserveScroll(['queue', 'browse'], () => {
        el.innerHTML = html    
    })
}

function formatSeconds(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor(seconds / 60) % 60
    const s = seconds % 60
    const ms = `${zeroPad(m)}:${zeroPad(s)}`
    if (h > 0) {
        return `${h}:${ms}`
    } else {
        return ms
    }
}

function zeroPad(s) {
    return `0${s}`.slice(-2)
}

function escape (str) {
    // seems to be buried in VueJS, so just copied to code over
    // https://github.com/vuejs/vue/blob/43485fbc5b779e02122c3b7fc64296a2cfee31f6/src/platforms/web/server/util.js
    return str.replace(/[<>"&]/g, (a) => {
      return {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '&': '&amp;'
      }[a]
    })
}
  

start()