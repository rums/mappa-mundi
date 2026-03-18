// Basic class with constructor, public methods, public properties
export class UserService {
  public name: string;
  private secret: string;
  protected internal: number;

  constructor(name: string) {
    this.name = name;
    this.secret = '';
    this.internal = 0;
  }

  public validate(): boolean {
    return true;
  }

  private doInternal(): void {
    // excluded from signature
  }

  protected onInit(): void {
    // excluded from signature
  }
}

// Constructor parameter properties
export class Config {
  constructor(
    public host: string,
    private port: number,
    protected scheme: string
  ) {}
}

// Abstract class
export abstract class BaseEntity {
  abstract getId(): string;
  public toString(): string {
    return this.getId();
  }
}

// Static members
export class MathUtils {
  static PI: number = 3.14;
  static add(a: number, b: number): number {
    return a + b;
  }
}

// Getter/setter
export class Temperature {
  private _celsius: number = 0;

  get fahrenheit(): number {
    return this._celsius * 9 / 5 + 32;
  }

  set fahrenheit(f: number) {
    this._celsius = (f - 32) * 5 / 9;
  }
}

// Generic class
export class Container<T> {
  private items: T[] = [];

  add(item: T): void {
    this.items.push(item);
  }

  get(index: number): T {
    return this.items[index];
  }
}
