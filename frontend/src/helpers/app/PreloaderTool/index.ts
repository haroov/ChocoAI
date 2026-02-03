import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import FullScreenPreloader from './FullScreenPreloader';

export default class PreloaderTool {
  #container?: HTMLDivElement;
  #reactRoot?: Root;
  #PreloaderComponent: React.ComponentType;

  constructor(PreloaderComponent?: React.ComponentType) {
    this.#PreloaderComponent = PreloaderComponent || FullScreenPreloader;
  }

  show() {
    if (this.#container) return;

    this.#container = document.createElement('div');
    document.body.appendChild(this.#container);

    this.#reactRoot = createRoot(this.#container);
    this.#reactRoot?.render(React.createElement(this.#PreloaderComponent));
  }

  hide() {
    this.#reactRoot?.unmount();
    this.#container?.remove();

    this.#container = undefined;
    this.#reactRoot = undefined;
  }
}
