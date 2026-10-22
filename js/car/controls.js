class Controls {
  constructor(type) {
    this.forward = false;
    this.left = false;
    this.right = false;
    this.reverse = false;
    this.boost = false;
    this.type = type;

    switch (type) {
      case "KEYS":
        this.#addKeyboardListeners();
        break;
      case "DUMMY":
        this.forward = true;
        break;
    }
  }

  #addKeyboardListeners() {
    const map = {
      ArrowUp: "forward", KeyW: "forward",
      ArrowDown: "reverse", KeyS: "reverse",
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right",
      ShiftLeft: "boost", ShiftRight: "boost",
    };
    this.onKey = (evt) => {
      if (isTyping(evt) || evt.metaKey || evt.ctrlKey) return;
      const action = map[evt.code];
      if (!action) return;
      this[action] = evt.type === "keydown";
      if (evt.code.startsWith("Arrow")) evt.preventDefault();
    };
    this.onBlur = () => {
      this.forward = this.reverse = this.left = this.right = this.boost = false;
    };
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);
  }

  dispose() {
    if (this.onKey) {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.onBlur);
    }
  }
}
