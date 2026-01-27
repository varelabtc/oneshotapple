// Apple Shot - Game Engine
(function() {
    var canvas, ctx, W, H;
    var state = 'menu'; // menu, aiming, flying, hit, miss, gameover, victory
    var levelConfig = null;
    var currentLevel = 1;
    var session = null;
    var player = null;

    // Game objects
    var archer = { x: 0, y: 0 };
    var target = { x: 0, y: 0, baseY: 0, appleSize: 20, headSize: 30, movePhase: 0 };
    var arrow = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, active: false };
    var aimAngle = 0;
    var wind = 0;
    var windDisplay = 0;
    var obstacles = [];
    var timeLeft = 0;
    var timeLimit = 0;
    var timerStart = 0;

    // Visual
    var stars = [];
    var particles = [];
    var groundY = 0;

    function init() {
        canvas = document.getElementById('gameCanvas');
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);

        // Generate stars
        for (var i = 0; i < 60; i++) {
            stars.push({
                x: Math.random(),
                y: Math.random() * 0.6,
                size: Math.random() * 1.5 + 0.5,
                blink: Math.random() * Math.PI * 2
            });
        }

        // Input
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('click', onShoot);
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchShoot);

        // Check saved player
        var saved = localStorage.getItem('appleshot_player');
        if (saved) {
            player = JSON.parse(saved);
            showStartModal();
        } else {
            showRegisterModal();
        }

        requestAnimationFrame(loop);
    }

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        groundY = H * 0.78;
        archer.x = W * 0.12;
        archer.y = groundY;
    }

    // --- Input ---
    function onMouseMove(e) {
        if (state !== 'aiming') return;
        var dx = e.clientX - archer.x;
        var dy = e.clientY - archer.y;
        aimAngle = Math.atan2(dy, dx);
        aimAngle = Math.max(-Math.PI / 2.5, Math.min(-0.05, aimAngle));
    }

    function onTouchMove(e) {
        e.preventDefault();
        if (state !== 'aiming') return;
        var t = e.touches[0];
        var dx = t.clientX - archer.x;
        var dy = t.clientY - archer.y;
        aimAngle = Math.atan2(dy, dx);
        aimAngle = Math.max(-Math.PI / 2.5, Math.min(-0.05, aimAngle));
    }

    function onShoot() {
        if (state !== 'aiming') return;
        fireArrow();
    }

    function onTouchShoot(e) {
        if (state !== 'aiming') return;
        fireArrow();
    }

    function fireArrow() {
        state = 'flying';
        var speed = levelConfig ? levelConfig.arrowSpeed : 10;
        arrow.x = archer.x + 30;
        arrow.y = archer.y - 40;
        arrow.vx = Math.cos(aimAngle) * speed;
        arrow.vy = Math.sin(aimAngle) * speed;
        arrow.angle = aimAngle;
        arrow.active = true;
    }

    // --- Level ---
    function loadLevel(level) {
        currentLevel = level;
        API.getLevelConfig(level).then(function(config) {
            levelConfig = config;
            setupLevel(config);
        }).catch(function() {
            // Fallback: generate locally
            levelConfig = generateLocalConfig(level);
            setupLevel(levelConfig);
        });
    }

    function generateLocalConfig(level) {
        var t = (level - 1) / 99;
        return {
            level: level,
            targetSize: lerp(40, 12, t),
            distance: lerp(300, 600, t),
            windSpeed: lerp(0, 4, Math.max(0, (t - 0.05) / 0.95)),
            targetMovement: level >= 20,
            movementSpeed: level >= 20 ? lerp(0, 3, (level - 20) / 80) : 0,
            hasObstacles: level >= 40,
            obstacleCount: level >= 40 ? Math.min(3, Math.floor((level - 40) / 20) + 1) : 0,
            timeLimit: level >= 60 ? lerp(8000, 3000, (level - 60) / 40) : 0,
            arrowSpeed: lerp(12, 6, t),
            windVariation: level >= 80
        };
    }

    function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

    function setupLevel(config) {
        // Target position
        target.x = archer.x + Math.min(config.distance, W * 0.7);
        target.baseY = groundY;
        target.y = target.baseY;
        target.appleSize = config.targetSize;
        target.headSize = config.targetSize * 1.6;
        target.movePhase = 0;

        // Wind
        wind = (Math.random() - 0.5) * 2 * config.windSpeed;
        windDisplay = wind;

        // Obstacles
        obstacles = [];
        if (config.hasObstacles) {
            for (var i = 0; i < config.obstacleCount; i++) {
                var ox = lerp(archer.x + 100, target.x - 60, (i + 1) / (config.obstacleCount + 1));
                var oh = Math.random() * 80 + 40;
                var oy = groundY - oh;
                obstacles.push({ x: ox, y: oy, w: 12, h: oh });
            }
        }

        // Timer
        timeLimit = config.timeLimit || 0;
        timeLeft = timeLimit;
        timerStart = Date.now();

        // Reset arrow
        arrow.active = false;
        aimAngle = -0.3;
        particles = [];
        state = 'aiming';

        updateHUD();
    }

    // --- Update ---
    function update() {
        if (state === 'aiming') {
            // Target movement
            if (levelConfig && levelConfig.targetMovement) {
                target.movePhase += 0.02 * (levelConfig.movementSpeed || 1);
                target.y = target.baseY + Math.sin(target.movePhase) * 50;
            }

            // Wind variation
            if (levelConfig && levelConfig.windVariation) {
                wind = windDisplay + Math.sin(Date.now() * 0.001) * 0.5;
            }

            // Timer
            if (timeLimit > 0) {
                timeLeft = timeLimit - (Date.now() - timerStart);
                if (timeLeft <= 0) {
                    timeLeft = 0;
                    state = 'miss';
                    onMiss();
                }
            }
        }

        if (state === 'flying') {
            // Arrow physics
            arrow.vy += 0.15; // gravity
            arrow.vx += wind * 0.008; // wind
            arrow.x += arrow.vx;
            arrow.y += arrow.vy;
            arrow.angle = Math.atan2(arrow.vy, arrow.vx);

            // Target movement during flight
            if (levelConfig && levelConfig.targetMovement) {
                target.movePhase += 0.02 * (levelConfig.movementSpeed || 1);
                target.y = target.baseY + Math.sin(target.movePhase) * 50;
            }

            // Check collision with apple
            var appleX = target.x;
            var appleY = target.y - target.headSize - target.appleSize * 0.8;
            var dist = Math.sqrt((arrow.x - appleX) * (arrow.x - appleX) + (arrow.y - appleY) * (arrow.y - appleY));
            if (dist < target.appleSize * 0.7) {
                state = 'hit';
                onHit();
                spawnParticles(appleX, appleY, '#00ff41', 20);
                return;
            }

            // Check collision with head (miss - hit the person)
            var headX = target.x;
            var headY = target.y - target.headSize * 0.5;
            var headDist = Math.sqrt((arrow.x - headX) * (arrow.x - headX) + (arrow.y - headY) * (arrow.y - headY));
            if (headDist < target.headSize * 0.5) {
                state = 'miss';
                onMiss();
                spawnParticles(headX, headY, '#ff2d2d', 15);
                return;
            }

            // Check collision with obstacles
            for (var i = 0; i < obstacles.length; i++) {
                var o = obstacles[i];
                if (arrow.x > o.x - o.w / 2 && arrow.x < o.x + o.w / 2 && arrow.y > o.y && arrow.y < o.y + o.h) {
                    state = 'miss';
                    onMiss();
                    spawnParticles(arrow.x, arrow.y, '#555', 10);
                    return;
                }
            }

            // Out of bounds
            if (arrow.x > W + 50 || arrow.y > H + 50 || arrow.x < -50 || arrow.y < -200) {
                state = 'miss';
                onMiss();
                return;
            }
        }

        // Update particles
        for (var i = particles.length - 1; i >= 0; i--) {
            var p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1;
            p.life -= 0.02;
            if (p.life <= 0) particles.splice(i, 1);
        }
    }

    function spawnParticles(x, y, color, count) {
        for (var i = 0; i < count; i++) {
            particles.push({
                x: x, y: y,
                vx: (Math.random() - 0.5) * 6,
                vy: (Math.random() - 0.5) * 6 - 2,
                life: 1,
                color: color,
                size: Math.random() * 4 + 2
            });
        }
    }

    // --- Hit / Miss ---
    function onHit() {
        if (!session) return;
        API.submitShot(session.sessionId, session.sessionHash, currentLevel, true).then(function(result) {
            if (result.completed) {
                setTimeout(function() { showVictoryModal(result.position, result.prize); }, 800);
            } else {
                setTimeout(function() { loadLevel(result.nextLevel); }, 1000);
            }
        }).catch(function() {
            setTimeout(function() { loadLevel(currentLevel + 1); }, 1000);
        });
    }

    function onMiss() {
        if (!session) return;
        API.submitShot(session.sessionId, session.sessionHash, currentLevel, false).then(function() {
            setTimeout(function() { showGameOverModal(); }, 1200);
        }).catch(function() {
            setTimeout(function() { showGameOverModal(); }, 1200);
        });
    }

    // --- Render ---
    function render() {
        ctx.clearRect(0, 0, W, H);

        // Sky gradient
        var sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#020408');
        sky.addColorStop(0.5, '#050a0f');
        sky.addColorStop(1, '#0a1510');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // Stars
        var time = Date.now() * 0.001;
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            var alpha = 0.3 + Math.sin(time + s.blink) * 0.2;
            ctx.fillStyle = 'rgba(0, 255, 65, ' + alpha + ')';
            ctx.fillRect(s.x * W, s.y * H, s.size, s.size);
        }

        // Ground
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, groundY, W, H - groundY);
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(W, groundY);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Grid lines on ground
        ctx.globalAlpha = 0.05;
        ctx.strokeStyle = '#00ff41';
        for (var gx = 0; gx < W; gx += 40) {
            ctx.beginPath();
            ctx.moveTo(gx, groundY);
            ctx.lineTo(gx, H);
            ctx.stroke();
        }
        for (var gy = groundY; gy < H; gy += 40) {
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(W, gy);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Obstacles
        for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i];
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(o.x - o.w / 2, o.y, o.w, o.h);
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.2)';
            ctx.strokeRect(o.x - o.w / 2, o.y, o.w, o.h);
        }

        // Target person
        drawTarget();

        // Archer
        drawArcher();

        // Aim line
        if (state === 'aiming') {
            ctx.save();
            ctx.setLineDash([4, 8]);
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(archer.x + 30, archer.y - 40);
            var lineLen = 120;
            ctx.lineTo(archer.x + 30 + Math.cos(aimAngle) * lineLen, archer.y - 40 + Math.sin(aimAngle) * lineLen);
            ctx.stroke();
            ctx.restore();
        }

        // Arrow
        if (arrow.active) {
            drawArrow();
        }

        // Particles
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;

        // HUD drawn on canvas for timer
        if (timeLimit > 0 && state === 'aiming') {
            var pct = timeLeft / timeLimit;
            var barW = 200;
            var barH = 4;
            var barX = (W - barW) / 2;
            var barY = 80;
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = pct > 0.3 ? '#00ff41' : '#ff2d2d';
            ctx.fillRect(barX, barY, barW * pct, barH);
        }
    }

    function drawArcher() {
        var x = archer.x;
        var y = archer.y;

        // Body
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x - 8, y - 50, 16, 35);

        // Head
        ctx.beginPath();
        ctx.arc(x, y - 58, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#2a2a2a';
        ctx.fill();
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Bow
        ctx.save();
        ctx.translate(x + 10, y - 40);
        ctx.rotate(aimAngle + Math.PI / 2);
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 25, -Math.PI * 0.6, Math.PI * 0.6);
        ctx.stroke();

        // String
        ctx.strokeStyle = 'rgba(0, 255, 65, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        var sx = Math.cos(-Math.PI * 0.6) * 25;
        var sy = Math.sin(-Math.PI * 0.6) * 25;
        ctx.moveTo(sx, sy);
        ctx.lineTo(0, 0);
        ctx.lineTo(Math.cos(Math.PI * 0.6) * 25, Math.sin(Math.PI * 0.6) * 25);
        ctx.stroke();
        ctx.restore();

        // Legs
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 15);
        ctx.lineTo(x - 8, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 15);
        ctx.lineTo(x + 8, y);
        ctx.stroke();
    }

    function drawTarget() {
        var x = target.x;
        var y = target.y;
        var hs = target.headSize;
        var as = target.appleSize;

        // Body
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x - 8, y - hs - 5, 16, hs * 0.8);

        // Head
        ctx.beginPath();
        ctx.arc(x, y - hs * 0.5, hs * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#2a2a2a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 255, 65, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Eyes
        ctx.fillStyle = '#00ff41';
        ctx.fillRect(x - 5, y - hs * 0.55, 3, 3);
        ctx.fillRect(x + 3, y - hs * 0.55, 3, 3);

        // Legs
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 5);
        ctx.lineTo(x - 8, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 5);
        ctx.lineTo(x + 8, y);
        ctx.stroke();

        // Apple
        var appleY = y - hs - as * 0.8;
        ctx.beginPath();
        ctx.arc(x, appleY, as * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff2d2d';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 45, 45, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Apple stem
        ctx.strokeStyle = '#4a2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, appleY - as * 0.45);
        ctx.lineTo(x + 3, appleY - as * 0.7);
        ctx.stroke();

        // Apple highlight
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x - as * 0.15, appleY - as * 0.15, as * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    function drawArrow() {
        ctx.save();
        ctx.translate(arrow.x, arrow.y);
        ctx.rotate(arrow.angle);

        // Shaft
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(10, 0);
        ctx.stroke();

        // Tip
        ctx.fillStyle = '#00ff41';
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(8, -4);
        ctx.lineTo(8, 4);
        ctx.closePath();
        ctx.fill();

        // Glow
        ctx.shadowColor = '#00ff41';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(12, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();
    }

    // --- Loop ---
    function loop() {
        update();
        render();
        requestAnimationFrame(loop);
    }

    // --- HUD ---
    function updateHUD() {
        var el = document.getElementById('hudLevel');
        if (el) el.textContent = currentLevel + '/100';
        var wEl = document.getElementById('hudWind');
        if (wEl) {
            var dir = wind > 0 ? '>>>' : wind < 0 ? '<<<' : '---';
            wEl.textContent = dir + ' ' + Math.abs(wind).toFixed(1);
        }
    }

    // --- Modals ---
    function showRegisterModal() {
        showModal('register');
    }

    function showStartModal() {
        showModal('start');
    }

    function showGameOverModal() {
        showModal('gameover');
        var el = document.getElementById('goLevel');
        if (el) el.textContent = currentLevel;
    }

    function showVictoryModal(position, prize) {
        showModal('victory');
        var posEl = document.getElementById('victoryPos');
        if (posEl) posEl.textContent = position ? '#' + position : 'Completed!';
        var prizeEl = document.getElementById('victoryPrize');
        if (prizeEl) prizeEl.textContent = prize ? prize.toFixed(2) : '0';
    }

    function showModal(id) {
        document.querySelectorAll('.modal-overlay').forEach(function(m) { m.classList.add('hidden'); });
        var el = document.getElementById('modal-' + id);
        if (el) el.classList.remove('hidden');
    }

    function hideAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(function(m) { m.classList.add('hidden'); });
    }

    // --- Global handlers ---
    window.doRegister = function() {
        var username = document.getElementById('regUsername').value.trim();
        var wallet = document.getElementById('regWallet').value.trim();
        if (!username || username.length < 2) return;
        API.register(username, wallet).then(function(data) {
            if (data.player) {
                player = data.player;
                localStorage.setItem('appleshot_player', JSON.stringify(player));
                showStartModal();
            }
        });
    };

    window.doStartGame = function() {
        if (!player) return;
        API.startGame(player.id).then(function(data) {
            session = data;
            hideAllModals();
            loadLevel(1);
        });
    };

    window.doRetry = function() {
        if (!player) return;
        API.startGame(player.id).then(function(data) {
            session = data;
            hideAllModals();
            loadLevel(1);
        });
    };

    window.goHome = function() {
        window.location.href = '/';
    };

    // Init on load
    window.addEventListener('DOMContentLoaded', init);
})();
