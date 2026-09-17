// Capture du micro, hors du fil principal : chaque bloc d'échantillons (canal 0)
// est envoyé tel quel à la page, qui l'assemble et l'encode.
class GallusRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor('gallus-recorder', GallusRecorder);
