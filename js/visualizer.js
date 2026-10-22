// Draws a neural network: blue = negative, yellow = positive.
class Visualizer {
  static drawNetwork(ctx, network, width, height) {
    const margin = 24;
    const left = margin, top = margin;
    const w = width - margin * 2, h = height - margin * 2;
    const levelHeight = h / network.levels.length;

    for (let i = network.levels.length - 1; i >= 0; i--) {
      const levelTop = top + lerp(h - levelHeight, 0, network.levels.length == 1 ? 0.5 : i / (network.levels.length - 1));
      ctx.setLineDash([7, 3]);
      Visualizer.drawLevel(ctx, network.levels[i], left, levelTop, w, levelHeight,
        i == network.levels.length - 1 ? ["↑", "←", "→", "↓"] : []);
    }
  }

  static drawLevel(ctx, level, left, top, width, height, outputLabels) {
    const right = left + width;
    const bottom = top + height;
    const { inputs, outputs, weights, biases } = level;
    const nodeRadius = 9;

    for (let i = 0; i < inputs.length; i++) {
      for (let j = 0; j < outputs.length; j++) {
        ctx.beginPath();
        ctx.moveTo(Visualizer.#nodeX(inputs, i, left, right), bottom);
        ctx.lineTo(Visualizer.#nodeX(outputs, j, left, right), top);
        ctx.lineWidth = 2;
        ctx.strokeStyle = Visualizer.#rgba(weights[i][j]);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    for (let i = 0; i < inputs.length; i++) {
      const x = Visualizer.#nodeX(inputs, i, left, right);
      ctx.beginPath();
      ctx.arc(x, bottom, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "black";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, bottom, nodeRadius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = Visualizer.#rgba(inputs[i]);
      ctx.fill();
    }

    for (let i = 0; i < outputs.length; i++) {
      const x = Visualizer.#nodeX(outputs, i, left, right);
      ctx.beginPath();
      ctx.arc(x, top, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "black";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, top, nodeRadius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = Visualizer.#rgba(outputs[i]);
      ctx.fill();

      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.arc(x, top, nodeRadius * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = Visualizer.#rgba(biases[i]);
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (outputLabels[i]) {
        ctx.beginPath();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "black";
        ctx.strokeStyle = "white";
        ctx.font = nodeRadius * 1.4 + "px Arial";
        ctx.fillText(outputLabels[i], x, top + 1);
        ctx.lineWidth = 0.5;
        ctx.strokeText(outputLabels[i], x, top + 1);
      }
    }
  }

  static #nodeX(nodes, index, left, right) {
    return lerp(left, right, nodes.length == 1 ? 0.5 : index / (nodes.length - 1));
  }

  static #rgba(value) {
    const alpha = Math.abs(value);
    const R = value < 0 ? 0 : 255;
    const G = R;
    const B = value > 0 ? 0 : 255;
    return "rgba(" + R + "," + G + "," + B + "," + alpha + ")";
  }
}
