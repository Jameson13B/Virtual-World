// Reads QR codes (and product barcodes where the phone supports it) from the
// live camera, or from a photo as a fallback. Uses the built-in
// BarcodeDetector when available (Android/Chrome) and jsQR otherwise (iPhone).
class Scanner {
  static FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e"];

  constructor(video, onResult) {
    this.video = video;
    this.onResult = onResult;
    this.stream = null;
    this.running = false;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  static canUseLiveCamera() {
    return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  static async detector() {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const formats = Scanner.FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new BarcodeDetector({ formats }) : null;
    } catch {
      return null;
    }
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "");
    await this.video.play();
    this.detectorInstance = await Scanner.detector();
    this.running = true;
    this.#loop();
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async #loop() {
    while (this.running) {
      try {
        const found = await this.#scan(this.video, this.video.videoWidth, this.video.videoHeight, "dontInvert");
        if (found && this.running) {
          this.stop();
          this.onResult(found.text, found.format);
          return;
        }
      } catch (e) {
        console.warn(e);
      }
      await new Promise((r) => setTimeout(r, 180));
    }
  }

  async #scan(source, w, h, inversion) {
    if (!w || !h) return null;
    if (this.detectorInstance) {
      const codes = await this.detectorInstance.detect(source);
      if (codes.length) return { text: codes[0].rawValue, format: codes[0].format };
      return null;
    }
    if (typeof jsQR === "undefined") return null;
    const s = Math.min(1, 720 / Math.max(w, h));
    this.canvas.width = Math.round(w * s);
    this.canvas.height = Math.round(h * s);
    this.ctx.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: inversion });
    return code && code.data ? { text: code.data, format: "qr_code" } : null;
  }

  // Decode a photo the player took (works everywhere, even without HTTPS).
  async decodeFile(file) {
    const bmp = await createImageBitmap(file);
    this.detectorInstance = await Scanner.detector();
    try {
      return await this.#scan(bmp, bmp.width, bmp.height, "attemptBoth");
    } finally {
      bmp.close && bmp.close();
    }
  }
}
