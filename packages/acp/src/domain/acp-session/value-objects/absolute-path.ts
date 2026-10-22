const DRIVE = /^[A-Za-z]:[\\/]/;

/**
 * An ACP client path split into its absolute root and parts, without empty and `.` parts. `..` stays for the platform
 * to resolve after any links before it: `link/..` is the link target's parent.
 */
export class AbsolutePath {
  /** `undefined` for a relative path, which names no place the session chose. */
  static parse(path: string): AbsolutePath | undefined {
    let root: string;
    let rest: string;
    let separator: RegExp;
    if (path.startsWith("/")) {
      root = "/";
      rest = path.slice(1);
      separator = /\/+/;
    } else if (DRIVE.test(path)) {
      root = `${path.slice(0, 2).toUpperCase()}\\`;
      rest = path.slice(3);
      separator = /[\\/]+/;
    } else {
      return undefined;
    }
    const parts: string[] = [];
    for (const part of rest.split(separator)) {
      if (part !== "" && part !== ".") {
        parts.push(part);
      }
    }
    return new AbsolutePath(root, parts);
  }

  readonly root: string;
  readonly parts: readonly string[];

  private constructor(root: string, parts: readonly string[]) {
    this.root = root;
    this.parts = Object.freeze([...parts]);
    Object.freeze(this);
  }

  format(): string {
    return this.root === "/" ? `/${this.parts.join("/")}` : `${this.root}${this.parts.join("\\")}`;
  }

  /**
   * Whether this resolved path is `root` or below it. A path that still has a `..` part is never within; a name that
   * only starts with `..`, such as `..notes`, is an ordinary name.
   */
  isWithin(root: AbsolutePath): boolean {
    return (
      !this.parts.includes("..") &&
      root.root === this.root &&
      root.parts.length <= this.parts.length &&
      root.parts.every((part, index) => part === this.parts[index])
    );
  }

  prefix(size: number): AbsolutePath {
    return new AbsolutePath(this.root, this.parts.slice(0, size));
  }

  append(parts: readonly string[]): AbsolutePath {
    return new AbsolutePath(this.root, [...this.parts, ...parts]);
  }
}
