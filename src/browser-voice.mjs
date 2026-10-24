export class BrowserVoice {
  constructor({ Recognition, onStatus, onText, onFailure, now = () => performance.now() }) {
    this.Recognition = Recognition;
    this.onStatus = onStatus;
    this.onText = onText;
    this.onFailure = onFailure;
    this.now = now;
    this.active = null;
    this.sequence = 0;
    this.timer = null;
  }

  start() {
    if (this.active) return false;
    if (!this.Recognition) {
      this.onFailure('unsupported');
      return false;
    }
    let recognition;
    try {
      recognition = new this.Recognition();
    } catch {
      this.onFailure('unavailable');
      return false;
    }
    const session = ++this.sequence;
    let resultCount = 0;
    const fail = (reason) => {
      if (this.active !== recognition) return;
      this.stop();
      this.onFailure(reason);
    };
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      if (this.active !== recognition) return;
      clearTimeout(this.timer);
      this.onStatus('listening');
    };
    recognition.onresult = (event) => {
      if (this.active !== recognition) return;
      // Interim entries may be removed entirely, not just replaced with new text.
      for (let i = event.results.length; i < resultCount; i += 1) {
        this.onText({ text: '', resultId: `${session}:${i}`, receivedAt: this.now(), isFinal: false });
      }
      resultCount = event.results.length;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (this.active !== recognition) break;
        const result = event.results[i];
        this.onText({
          text: result[0].transcript,
          resultId: `${session}:${i}`,
          receivedAt: this.now(),
          isFinal: result.isFinal,
        });
      }
    };
    recognition.onerror = (event) => fail(event.error || 'unknown');
    recognition.onend = () => fail('disconnected');
    this.active = recognition;
    this.onStatus('starting');
    this.timer = setTimeout(() => fail('timeout'), 15000);
    try {
      recognition.start();
    } catch {
      fail('start_failed');
      return false;
    }
    return true;
  }

  stop() {
    const recognition = this.active;
    this.active = null;
    clearTimeout(this.timer);
    this.timer = null;
    if (recognition) {
      try { recognition.abort(); } catch { /* Already stopped by the browser. */ }
    }
    this.onStatus('stopped');
  }
}
