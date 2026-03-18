import type { Layer } from './types';

export class LayerRegistry {
  private layers = new Map<string, Layer>();

  register(layer: Layer): void {
    this.layers.set(layer.id, layer);
  }

  get(id: string): Layer | undefined {
    return this.layers.get(id);
  }

  list(): Layer[] {
    return Array.from(this.layers.values());
  }
}
