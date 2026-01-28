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

    // Lives
    var lives = 3;
    var maxLives = 3;

    // Power / force
    var power = 0;          // 0-1
    var charging = false;
    var chargeSpeed = 0.005; // how fast power fills
    var chargeDir = 1;       // 1=up, -1=down (oscillates)
    var maxPower = 1;
    var minPower = 0.2;

    // Wind particles
    var windParticles = [];
    var windTrails = [];

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
        canvas.addEventListener('mousedown', onChargeStart);
        canvas.addEventListener('mouseup', onChargeRelease);
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchstart', onTouchChargeStart, { passive: false });
        canvas.addEventListener('touchend', onTouchChargeRelease);

        // Check saved player
        var saved = localStorage.getItem('appleshot_player');
        if (saved) {
            player = JSON.parse(saved);
            syncGlobals();
            showStartModal();
        } else {
            showRegisterModal();
        }

        requestAnimationFrame(loop);
    }

    function resize() {
        var gameArea = canvas.parentElement;
        W = canvas.width = gameArea.clientWidth;
        H = canvas.height = gameArea.clientHeight;
        groundY = H * 0.78;
        archer.x = W * 0.12;
        archer.y = groundY;
    }

    // --- Input ---
    function canvasCoords(clientX, clientY) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) * (W / rect.width),
            y: (clientY - rect.top) * (H / rect.height)
        };
    }

    function onMouseMove(e) {
        if (state !== 'aiming') return;
        var pos = canvasCoords(e.clientX, e.clientY);
        var dx = pos.x - archer.x;
        var dy = pos.y - archer.y;
        aimAngle = Math.atan2(dy, dx);
        aimAngle = Math.max(-Math.PI / 2.5, Math.min(-0.05, aimAngle));
    }

    function onTouchMove(e) {
        e.preventDefault();
        if (state !== 'aiming') return;
        var t = e.touches[0];
        var pos = canvasCoords(t.clientX, t.clientY);
        var dx = pos.x - archer.x;
        var dy = pos.y - archer.y;
        aimAngle = Math.atan2(dy, dx);
        aimAngle = Math.max(-Math.PI / 2.5, Math.min(-0.05, aimAngle));
    }

    function onChargeStart(e) {
        if (state !== 'aiming') return;
        charging = true;
        power = minPower;
        chargeDir = 1;
    }

    function onChargeRelease(e) {
        if (state !== 'aiming' || !charging) return;
        charging = false;
        fireArrow();
    }

    function onTouchChargeStart(e) {
        if (state !== 'aiming') return;
        charging = true;
        power = minPower;
        chargeDir = 1;
    }

    function onTouchChargeRelease(e) {
        if (state !== 'aiming' || !charging) return;
        charging = false;
        fireArrow();
    }

    function fireArrow() {
        state = 'flying';
        var baseSpeed = levelConfig ? levelConfig.arrowSpeed : 10;
        var speed = baseSpeed * (0.6 + power * 0.4); // power scales speed from 60% to 100%
        arrow.x = archer.x + 30;
        arrow.y = archer.y - 40;
        arrow.vx = Math.cos(aimAngle) * speed;
        arrow.vy = Math.sin(aimAngle) * speed;
        arrow.angle = aimAngle;
        arrow.active = true;
        power = 0;
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
        // 35 levels - harder at start, balanced progression
        var t = (level - 1) / 34;
        var difficultyFactor = Math.pow(t, 0.7); // harder early game

        return {
            level: level,
            targetSize: lerp(32, 10, difficultyFactor),
            distance: lerp(350, 550, difficultyFactor),
            windSpeed: level >= 3 ? lerp(0.5, 4.5, Math.max(0, (level - 3) / 32)) : 0,
            targetMovement: level >= 8,
            movementSpeed: level >= 8 ? lerp(0.8, 3.5, (level - 8) / 27) : 0,
            hasObstacles: level >= 15,
            obstacleCount: level >= 15 ? Math.min(3, Math.floor((level - 15) / 7) + 1) : 0,
            timeLimit: level >= 22 ? lerp(10000, 4000, (level - 22) / 13) : 0,
            arrowSpeed: lerp(13, 7, difficultyFactor),
            windVariation: level >= 28,
            movingObstacles: level >= 30
        };
    }

    function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

    // Line segment (x1,y1)-(x2,y2) intersects circle (cx,cy,r)?
    function lineCircleIntersect(x1, y1, x2, y2, cx, cy, r) {
        var dx = x2 - x1, dy = y2 - y1;
        var fx = x1 - cx, fy = y1 - cy;
        var a = dx * dx + dy * dy;
        if (a < 0.001) return false;
        var b = 2 * (fx * dx + fy * dy);
        var c = fx * fx + fy * fy - r * r;
        var disc = b * b - 4 * a * c;
        if (disc < 0) return false;
        disc = Math.sqrt(disc);
        var t1 = (-b - disc) / (2 * a);
        var t2 = (-b + disc) / (2 * a);
        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
    }

    function setupLevel(config) {
        // Target position - scale distance to screen, ensure it fits
        var maxDist = W * 0.65;
        var minDist = W * 0.25;
        var scaledDist = minDist + (maxDist - minDist) * ((config.distance - 300) / 300);
        scaledDist = Math.max(minDist, Math.min(maxDist, scaledDist));

        target.x = archer.x + scaledDist;
        target.baseY = groundY;
        target.y = target.baseY;
        target.appleSize = Math.max(10, config.targetSize);
        target.headSize = Math.max(16, config.targetSize * 1.6);
        target.movePhase = 0;

        // Wind
        wind = (Math.random() - 0.5) * 2 * config.windSpeed;
        windDisplay = wind;

        // Obstacles - placed between archer and target
        obstacles = [];
        if (config.hasObstacles) {
            var gapStart = archer.x + 80;
            var gapEnd = target.x - 50;
            for (var i = 0; i < config.obstacleCount; i++) {
                var ox = gapStart + (gapEnd - gapStart) * ((i + 1) / (config.obstacleCount + 1));
                var oh = 40 + Math.random() * 60 + currentLevel * 0.3;
                oh = Math.min(oh, groundY * 0.5);
                var oy = groundY - oh;
                obstacles.push({ x: ox, y: oy, w: 14, h: oh });
            }
        }

        // Timer
        timeLimit = config.timeLimit || 0;
        timeLeft = timeLimit;
        timerStart = Date.now();

        // Reset arrow and power
        arrow.active = false;
        aimAngle = -0.3;
        power = 0;
        charging = false;
        chargeDir = 1;
        particles = [];
        windParticles = [];
        state = 'aiming';

        updateHUD();
        syncGlobals();
    }

    // --- Update ---
    function update() {
        if (state === 'aiming') {
            // Power charging (oscillates between min and max)
            if (charging) {
                power += chargeSpeed * chargeDir;
                if (power >= maxPower) { power = maxPower; chargeDir = -1; }
                if (power <= minPower) { power = minPower; chargeDir = 1; }
            }

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

        // Wind particles (always update when wind exists)
        updateWindParticles();

        if (state === 'flying') {
            // Arrow physics
            arrow.vy += 0.10; // gravity
            arrow.vx += wind * 0.008; // wind
            arrow.x += arrow.vx;
            arrow.y += arrow.vy;
            arrow.angle = Math.atan2(arrow.vy, arrow.vx);

            // Target movement during flight
            if (levelConfig && levelConfig.targetMovement) {
                target.movePhase += 0.02 * (levelConfig.movementSpeed || 1);
                target.y = target.baseY + Math.sin(target.movePhase) * 50;
            }

            // Collision detection using multiple points along the arrow
            var appleX = target.x;
            var appleY = target.y - target.headSize - target.appleSize * 0.8;
            var appleR = target.appleSize * 0.5 + 10;

            // Check multiple points: arrow center, tip, and previous position (sweep)
            var tipX = arrow.x + Math.cos(arrow.angle) * 14;
            var tipY = arrow.y + Math.sin(arrow.angle) * 14;
            var prevX = arrow.x - arrow.vx;
            var prevY = arrow.y - arrow.vy;

            // Simple distance checks
            var d1 = (tipX - appleX) * (tipX - appleX) + (tipY - appleY) * (tipY - appleY);
            var d2 = (arrow.x - appleX) * (arrow.x - appleX) + (arrow.y - appleY) * (arrow.y - appleY);
            var rr = appleR * appleR;

            // Also check rectangular region (very generous fallback)
            var inAppleZone = Math.abs(arrow.x - appleX) < appleR + 5 && Math.abs(arrow.y - appleY) < appleR + 5;
            var tipInAppleZone = Math.abs(tipX - appleX) < appleR + 5 && Math.abs(tipY - appleY) < appleR + 5;

            // Sweep: line segment from prev to current position
            var sweepHit = lineCircleIntersect(prevX, prevY, tipX, tipY, appleX, appleY, appleR);

            if (d1 < rr || d2 < rr || inAppleZone || tipInAppleZone || sweepHit) {
                state = 'hit';
                onHit();
                spawnParticles(appleX, appleY, '#00ff41', 20);
                return;
            }

            // Check collision with head (miss - hit the person)
            var headX = target.x;
            var headY = target.y - target.headSize * 0.5;
            var headR = target.headSize * 0.45;
            var dHead = (arrow.x - headX) * (arrow.x - headX) + (arrow.y - headY) * (arrow.y - headY);
            if (dHead < headR * headR) {
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
        if (!session) {
            // No session - just advance locally
            var next = currentLevel + 1;
            if (next > 35) { showVictoryModal(null, null); return; }
            setTimeout(function() { loadLevel(next); }, 1000);
            return;
        }
        var lvl = currentLevel;
        API.submitShot(session.sessionId, session.sessionHash, lvl, true).then(function(result) {
            if (result && result.completed) {
                setTimeout(function() { showVictoryModal(result.position, result.prize); }, 800);
            } else if (result && result.nextLevel) {
                setTimeout(function() { loadLevel(result.nextLevel); }, 1000);
            } else {
                // API returned error or unexpected response - advance locally
                setTimeout(function() { loadLevel(lvl + 1); }, 1000);
            }
        }).catch(function() {
            setTimeout(function() { loadLevel(lvl + 1); }, 1000);
        });
    }

    function onMiss() {
        lives--;
        updateHUD();
        if (lives <= 0) {
            // Really game over
            if (session) {
                API.submitShot(session.sessionId, session.sessionHash, currentLevel, false, 0).then(function() {
                    setTimeout(function() { showGameOverModal(); }, 1200);
                }).catch(function() {
                    setTimeout(function() { showGameOverModal(); }, 1200);
                });
            } else {
                setTimeout(function() { showGameOverModal(); }, 1200);
            }
        } else {
            // Still have lives - retry same level
            setTimeout(function() { loadLevel(currentLevel); }, 1200);
        }
    }

    // --- Wind Particles ---
    function updateWindParticles() {
        var absWind = Math.abs(wind);
        if (absWind < 0.1) { windParticles = []; return; }

        // Spawn new wind particles
        var spawnRate = Math.floor(absWind * 2);
        for (var i = 0; i < spawnRate; i++) {
            if (windParticles.length > 80) break;
            var startX = wind > 0 ? -20 : W + 20;
            windParticles.push({
                x: startX + Math.random() * 100 * (wind > 0 ? -1 : 1),
                y: Math.random() * groundY,
                speed: absWind * (15 + Math.random() * 20),
                length: 15 + Math.random() * 25,
                alpha: 0.08 + Math.random() * 0.12,
                life: 1
            });
        }

        // Update
        for (var i = windParticles.length - 1; i >= 0; i--) {
            var wp = windParticles[i];
            wp.x += (wind > 0 ? 1 : -1) * wp.speed * 0.3;
            wp.life -= 0.008;
            if (wp.life <= 0 || wp.x > W + 50 || wp.x < -50) {
                windParticles.splice(i, 1);
            }
        }
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

        // Wind streaks on canvas
        if (Math.abs(wind) > 0.1) {
            for (var i = 0; i < windParticles.length; i++) {
                var wp = windParticles[i];
                ctx.globalAlpha = wp.alpha * wp.life;
                ctx.strokeStyle = '#00ff41';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(wp.x, wp.y);
                ctx.lineTo(wp.x + (wind > 0 ? 1 : -1) * wp.length, wp.y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // Power bar (right side of archer when charging or aiming)
        if (state === 'aiming') {
            var barX = archer.x - 30;
            var barH = 80;
            var barW = 6;
            var barY = archer.y - 60 - barH;

            // Background
            ctx.fillStyle = 'rgba(26, 26, 26, 0.8)';
            ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

            // Fill (bottom to top)
            var fillH = barH * power;
            var pColor;
            if (power < 0.4) pColor = 'rgba(0, 255, 65, 0.5)';
            else if (power < 0.7) pColor = '#00ff41';
            else if (power < 0.9) pColor = '#ffcc00';
            else pColor = '#ff4444';

            ctx.fillStyle = pColor;
            ctx.fillRect(barX, barY + barH - fillH, barW, fillH);

            // Glow when charging
            if (charging) {
                ctx.shadowColor = pColor;
                ctx.shadowBlur = 10;
                ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
                ctx.shadowBlur = 0;
            }

            // Label
            ctx.fillStyle = 'rgba(0, 255, 65, 0.6)';
            ctx.font = '9px Poppins, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('PWR', barX + barW / 2, barY - 4);

            // Percentage
            ctx.fillStyle = charging ? '#fff' : 'rgba(255,255,255,0.4)';
            ctx.font = 'bold 10px Poppins, sans-serif';
            ctx.fillText(Math.round(power * 100) + '%', barX + barW / 2, barY + barH + 14);
            ctx.textAlign = 'left';
        }

        // Wind indicator on canvas (top center)
        if (state === 'aiming' || state === 'flying') {
            var wX = W / 2;
            var wY = 55;
            var absW = Math.abs(wind);
            var maxW = 5;
            var windPct = Math.min(absW / maxW, 1);

            // Wind bar background
            var wBarW = 160;
            var wBarH = 6;
            ctx.fillStyle = 'rgba(26, 26, 26, 0.8)';
            ctx.fillRect(wX - wBarW / 2 - 2, wY - 2, wBarW + 4, wBarH + 4);
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(wX - wBarW / 2 - 2, wY - 2, wBarW + 4, wBarH + 4);

            // Center mark
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(wX - 0.5, wY - 2, 1, wBarH + 4);

            // Wind fill from center
            var fillW = (wBarW / 2) * windPct;
            var wColor = windPct < 0.3 ? '#00ff41' : windPct < 0.6 ? '#ffcc00' : '#ff4444';
            ctx.fillStyle = wColor;
            if (wind > 0) {
                ctx.fillRect(wX, wY, fillW, wBarH);
            } else if (wind < 0) {
                ctx.fillRect(wX - fillW, wY, fillW, wBarH);
            }

            // Glow
            if (absW > 0.5) {
                ctx.shadowColor = wColor;
                ctx.shadowBlur = 6;
                if (wind > 0) {
                    ctx.fillRect(wX, wY, fillW, wBarH);
                } else if (wind < 0) {
                    ctx.fillRect(wX - fillW, wY, fillW, wBarH);
                }
                ctx.shadowBlur = 0;
            }

            // Direction arrows
            ctx.fillStyle = absW > 0.1 ? wColor : 'rgba(255,255,255,0.2)';
            ctx.font = 'bold 12px Poppins, sans-serif';
            ctx.textAlign = 'center';
            var dirText = wind > 0.1 ? '\u25B6' : wind < -0.1 ? '\u25C0' : '\u25CF';
            ctx.fillText(dirText, wX + (wind > 0 ? fillW + 14 : wind < 0 ? -fillW - 14 : 0), wY + wBarH / 2 + 4);

            // Wind label
            ctx.fillStyle = 'rgba(0, 255, 65, 0.5)';
            ctx.font = '9px Poppins, sans-serif';
            ctx.fillText('WIND', wX, wY - 6);

            // Wind value
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '10px Poppins, sans-serif';
            ctx.fillText(absW.toFixed(1), wX, wY + wBarH + 14);
            ctx.textAlign = 'left';
        }

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
        if (el) el.textContent = currentLevel + '/35';
        var wEl = document.getElementById('hudWind');
        if (wEl) {
            var dir = wind > 0 ? '>>>' : wind < 0 ? '<<<' : '---';
            wEl.textContent = dir + ' ' + Math.abs(wind).toFixed(1);
        }
        var livesEl = document.getElementById('hudLives');
        if (livesEl) {
            var hearts = '';
            for (var i = 0; i < maxLives; i++) {
                hearts += i < lives ? '\u2764' : '\u2661';
            }
            livesEl.textContent = hearts;
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
    // Expose to sidebar
    function syncGlobals() {
        window._gamePlayer = player;
        window._gameCurrentLevel = currentLevel;
    }

    window.doRegister = function() {
        var username = document.getElementById('regUsername').value.trim();
        var wallet = document.getElementById('regWallet').value.trim();
        if (!username || username.length < 2) return;
        API.register(username, wallet).then(function(data) {
            if (data.player) {
                player = data.player;
                localStorage.setItem('appleshot_player', JSON.stringify(player));
                syncGlobals();
                showStartModal();
            }
        }).catch(function() {
            // Fallback: create local player when API fails
            player = { id: Date.now(), username: username, wallet_address: wallet };
            localStorage.setItem('appleshot_player', JSON.stringify(player));
            syncGlobals();
            showStartModal();
        });
    };

    window.doStartGame = function() {
        if (!player) return;
        API.startGame(player.id).then(function(data) {
            session = data;
            lives = maxLives;
            hideAllModals();
            loadLevel(1);
        }).catch(function() {
            // Fallback: start game locally when API fails
            session = { sessionId: Date.now(), sessionHash: 'local' };
            lives = maxLives;
            hideAllModals();
            loadLevel(1);
        });
    };

    window.doRetry = function() {
        if (!player) return;
        API.startGame(player.id).then(function(data) {
            session = data;
            lives = maxLives;
            hideAllModals();
            loadLevel(1);
        }).catch(function() {
            // Fallback: retry game locally when API fails
            session = { sessionId: Date.now(), sessionHash: 'local' };
            lives = maxLives;
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
