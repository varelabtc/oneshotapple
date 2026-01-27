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
    submitShot: function(sessionId, sessionHash, level, hit) {
        return fetch('/api/submit-shot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId, sessionHash: sessionHash, level: level, hit: hit })
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
    }
};
