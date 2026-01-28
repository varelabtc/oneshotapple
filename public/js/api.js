var API = {
    register: function(username, wallet) {
        return fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, wallet: wallet })
        }).then(function(r) { return r.json(); });
    },
    startGame: function(playerId) {
        return fetch('/api/start-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: playerId })
        }).then(function(r) { return r.json(); });
    },
    submitShot: function(sessionId, sessionHash, level, hit, livesLeft) {
        return fetch('/api/submit-shot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId, sessionHash: sessionHash, level: level, hit: hit, livesLeft: livesLeft })
        }).then(function(r) { return r.json(); });
    },
    getLevelConfig: function(level) {
        return fetch('/api/levels/' + level).then(function(r) { return r.json(); });
    },
    getSeason: function() {
        return fetch('/api/season').then(function(r) { return r.json(); });
    },
    getRanking: function() {
        return fetch('/api/ranking').then(function(r) { return r.json(); });
    },
    getLevelStats: function() {
        return fetch('/api/level-stats').then(function(r) { return r.json(); });
    },
    getChat: function(afterId) {
        return fetch('/api/chat?after=' + (afterId || 0)).then(function(r) { return r.json(); });
    },
    sendChat: function(playerId, message) {
        return fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: playerId, message: message })
        }).then(function(r) { return r.json(); });
    },
    getActivity: function(afterId) {
        return fetch('/api/activity?after=' + (afterId || 0)).then(function(r) { return r.json(); });
    },
    getPrizePool: function() {
        return fetch('/api/prize-pool').then(function(r) { return r.json(); });
    },
    getAllTimeStats: function() {
        return fetch('/api/all-time-stats').then(function(r) { return r.json(); });
    }
};
