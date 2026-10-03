// One countdown per game. Orders and mistakes never reset it.
window.GAME_TIME_SECONDS = 60;
window.GameTimer = class GameTimer {
    constructor(elementId, onExpire) {
        this.element = document.getElementById(elementId);
        this.onExpire = onExpire;
        this.remaining = 0;
        this.deadline = 0;
        this.interval = null;
        this.running = false;
    }

    display() {
        const seconds = Math.ceil(this.remaining / 1000);
        this.element.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        this.element.classList.toggle('time-low', seconds <= 10);
    }

    start(active) {
        this.stop();
        this.remaining = window.GAME_TIME_SECONDS * 1000;
        this.running = true;
        this.display();
        if (active) this.resume();
    }

    tick() {
        if (!this.running) return false;
        if (this.interval !== null) {
            this.remaining = Math.max(0, this.deadline - performance.now());
        }
        this.display();
        if (this.remaining === 0) {
            this.stop();
            this.onExpire();
            return false;
        }
        return true;
    }

    resume() {
        if (!this.running || this.interval !== null) return;
        this.deadline = performance.now() + this.remaining;
        this.interval = setInterval(() => this.tick(), 100);
    }

    pause() {
        if (this.interval !== null) this.tick();
        clearInterval(this.interval);
        this.interval = null;
    }

    stop() {
        clearInterval(this.interval);
        this.interval = null;
        this.running = false;
    }
};
