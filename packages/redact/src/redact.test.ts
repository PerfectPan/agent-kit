import { describe, expect, it } from "vite-plus/test";

import { redact, redactText } from "./redact.js";

const home = "/u/me";
const text = (value: string, at = home) => redactText(value, { home: at });

// Secret-shaped samples are assembled at run time, so the repository's own secret scan does not flag this file.
const fake = (prefix: string, length = 24) => `${prefix}${"Ab1".repeat(length).slice(0, length)}`;

describe("redactText", () => {
  it("S60: replaces the home directory unless the next character continues the segment", () => {
    expect(text(`I am in ${home}.`)).toBe("I am in ~.");
    expect(text(`PATH=${home}:/usr/bin`)).toBe("PATH=~:/usr/bin");
    expect(text(`(${home})`)).toBe("(~)");
    expect(text(`${home}/proj/a.ts`)).toBe("~/proj/a.ts");
    expect(text(`${home}x ${home}.bak ${home}-old ${home}é`)).toBe(`${home}x ${home}.bak ${home}-old ${home}é`);
    expect(text(`${home.toUpperCase()}/x`)).toBe("~/x");
    expect(text("/u/meeting and /var/u/me2")).toBe("/u/meeting and /var/u/me2");
  });

  it("S60: replaces the home directory after any character, without its leading slash, and JSON-escaped", () => {
    expect(text(`diff --git a${home}/x b${home}/x`)).toBe("diff --git a~/x b~/x");
    expect(text(`cd u/me/x`)).toBe("cd ~/x");
    expect(text("menu/me/x")).toBe("menu/me/x");
    expect(text(String.raw`{"cwd":"\/u\/me\/x"}`)).toBe(String.raw`{"cwd":"~\/x"}`);
  });

  it("hides a home that continues a longer path and keeps the separator before it", () => {
    // `/private/tmp` is `/tmp` on macOS and the Data volume path is the home itself: both stay hidden.
    expect(text("cd /private/tmp/x/a", "/tmp/x")).toBe("cd /private/~/a");
    expect(text(`ls /System/Volumes/Data${home}/x`)).toBe("ls /System/Volumes/Data/~/x");
    expect(text(String.raw`{"cwd":"\/private\/u\/me\/x"}`)).toBe(String.raw`{"cwd":"\/private\/~\/x"}`);
    expect(text("/mnt/c/Profiles/me/x", String.raw`C:\Profiles\me`)).toBe("/mnt/~/x");
    expect(text(`/𠀀${home}/x /Cafe\u0301${home}/x /opt/g++${home}/x`)).toBe("/𠀀/~/x /Cafe\u0301/~/x /opt/g++/~/x");
  });

  it("keeps a home after an escape, a colour sequence or a token without a separator as `~`", () => {
    expect(text(String.raw`"line\n${home}/x"`)).toBe(String.raw`"line\n~/x"`);
    expect(text(`%22${home}/x`)).toBe("%22~/x");
    expect(text(`\x1b[38;2;255;255;255;48;2;10;10;10m${home}/x`)).toBe("\x1b[38;2;255;255;255;48;2;10;10;10m~/x");
    expect(text(String.raw`\u001b[38;2;255;255;255;48;2;10;10;10m${home}/x`)).toBe(
      String.raw`\u001b[38;2;255;255;255;48;2;10;10;10m~/x`
    );
    expect(text(`gcc -I${home}/include`)).toBe("gcc -I~/include");
  });

  it("S60: replaces file URLs, including a percent-encoded home", () => {
    expect(text(`file://${home}/x`)).toBe("file://~/x");
    expect(text("file:///u/john%20doe/x", "/u/john doe")).toBe("file://~/x");
    expect(text("open /u/john doe/x", "/u/john doe")).toBe("open ~/x");
  });

  it("S60: replaces the Claude Code slug and the percent-encoded folder names of any home", () => {
    expect(text("proj -u-me-code file")).toBe("proj ~-code file");
    expect(text("dir %2Fu%2Fme%2Fsessions")).toBe("dir ~%2Fsessions");
    expect(text("dir %2fu%2fme%2fsessions")).toBe("dir ~%2fsessions");
    expect(text("x -u-john-doe-proj/a.jsonl", "/u/john.doe")).toBe("x ~-proj/a.jsonl");
    expect(text("x %2Fu%2Fzo%C3%AB%2Fproj", "/u/zoë")).toBe("x ~%2Fproj");
  });

  it("S60: hides a multi-segment home's slug after any character that is not a letter, digit, `_` or `%`", () => {
    const slug = "-u-alice-proj";
    const nameChar = /[A-Za-z0-9_%]/;
    for (let code = 0x20; code <= 0x7e; code++) {
      const before = String.fromCharCode(code);
      expect(text(`${before}${slug}`, "/u/alice")).toBe(nameChar.test(before) ? `${before}${slug}` : `${before}~-proj`);
    }
    expect(text(slug, "/u/alice")).toBe("~-proj");
    const leak = (value: string) => text(value, "/u/alice");
    expect(leak(`find ~/.claude/projects -name "*${slug}*"`)).toBe(`find ~/.claude/projects -name "*~-proj*"`);
    expect(leak(`**${slug}**`)).toBe("**~-proj**");
    expect(leak(`[${slug}](x)`)).toBe("[~-proj](x)");
  });

  it("S60: hides the slug and the slash-less home after a JSON escape or URL encoding, keeps them after a name character", () => {
    const at = (value: string) => text(value, "/u/alice");
    expect(at(String.raw`\n-u-alice-proj`)).toBe(String.raw`\n~-proj`);
    expect(at(String.raw`\t-u-alice-proj`)).toBe(String.raw`\t~-proj`);
    expect(at(String.raw`\u0022-u-alice-proj`)).toBe(String.raw`\u0022~-proj`);
    expect(at("%2F-u-alice-proj")).toBe("%2F~-proj");
    expect(at(String.raw`\nu/alice/x`)).toBe(String.raw`\n~/x`);
    expect(at("%22u/alice/x")).toBe("%22~/x");
    expect(at(String.raw`\u0022u/alice/x`)).toBe(String.raw`\u0022~/x`);
    expect(at(String.raw`x-u-alice-proj`)).toBe(String.raw`x-u-alice-proj`);
    expect(at("9u/alice/x")).toBe("9u/alice/x");
    // Accepting an escape before the start does not lengthen the name: `alicex` is another user's home.
    expect(at(String.raw`\n-u-alicex-proj`)).toBe(String.raw`\n-u-alicex-proj`);
    expect(at(String.raw`\nu/alicex/y`)).toBe(String.raw`\nu/alicex/y`);
  });

  it("S60: hides the encoded home after an escape, and the home shapes after an ANSI SGR sequence", () => {
    const at = (value: string) => text(value, "/u/alice");
    expect(at("%22%2Fu%2Falice%22")).toBe("%22~%22");
    expect(at("cwd%3D%2Fu%2Falice%2Fx")).toBe("cwd%3D~%2Fx");
    expect(at("file%3A%2F%2F%2Fu%2Falice")).toBe("file%3A%2F%2F~");
    expect(at(String.raw`\n%2Fu%2Falice%2Fx`)).toBe(String.raw`\n~%2Fx`);
    // A name character before the encoded home is none of the escapes: kept, as on main.
    expect(at("x%2Fu%2Falice")).toBe("x%2Fu%2Falice");
    // An SGR sequence ends in `m`, a name character; every start that accepts an escape accepts the sequence.
    expect(at(String.raw`\u001b[32mu/alice/x`)).toBe(String.raw`\u001b[32m~/x`);
    expect(at("\x1b[32mu/alice/x")).toBe("\x1b[32m~/x");
    expect(at(String.raw`\u001b[0m-u-alice-proj`)).toBe(String.raw`\u001b[0m~-proj`);
  });

  it("S60: replaces Windows spellings: either separator, JSON-escaped, file URLs and MSYS paths", () => {
    const windows = String.raw`C:\Profiles\me`;
    const at = (value: string) => text(value, windows);
    expect(at(String.raw`C:\Profiles\me\proj`)).toBe(String.raw`~\proj`);
    expect(at(String.raw`c:\profiles\ME\proj`)).toBe(String.raw`~\proj`);
    expect(at("C:/Profiles/me/proj")).toBe("~/proj");
    expect(at(String.raw`{"cwd":"C:\\Profiles\\me\\proj"}`)).toBe(String.raw`{"cwd":"~\\proj"}`);
    expect(at("file:///C:/Profiles/me/proj")).toBe("file:///~/proj");
    expect(at("/c/Profiles/me/proj")).toBe("~/proj");
    expect(at(String.raw`C:\Profiles\meg\x`)).toBe(String.raw`C:\Profiles\meg\x`);
    expect(at("C--Profiles-me-proj")).toBe("~-proj");
    expect(at("*C--Profiles-me-proj")).toBe("*~-proj");
    expect(at(String.raw`\nC--Profiles-me-proj`)).toBe(String.raw`\n~-proj`);
  });

  it("S60: replaces ~user, the shell's name for the home directory, also after a JSON escape", () => {
    expect(text("ls ~me/x and ~me")).toBe("ls ~/x and ~");
    expect(text("~meg/x")).toBe("~meg/x");
    expect(text(String.raw`"cd\n~me/x"`)).toBe(String.raw`"cd\n~/x"`);
  });

  it("does not hide the word of a one-segment home, and needs a segment start for the slug", () => {
    const root = "/root";
    expect(text("running as root, see /root/x and -root-proj", root)).toBe("running as root, see ~/x and ~-proj");
    expect(text("pre-root and %2Froot%2Fx", root)).toBe("pre-root and ~%2Fx");
    expect(text("npm --root-dir x *-root-p x.-root a--root", root)).toBe("npm --root-dir x *-root-p x.-root a--root");
    expect(text("*C--me-p", String.raw`C:\me`)).toBe("*C--me-p");
    expect(text("*C---me-p", "C:\\\\me")).toBe("*C---me-p");
    expect(text("x.--root", "//root")).toBe("x.--root");
    expect(text("cd u/me/x")).toBe("cd ~/x");
  });

  it("hides no path for an empty home or a file system root", () => {
    for (const root of ["", "/", "C:\\", "C:/"]) {
      expect(text("/u/me/x C:/x", root)).toBe("/u/me/x C:/x");
    }
    expect(text(`${home}/x`, `${home}/`)).toBe("~/x");
  });

  it.each([
    ["sk-", 24],
    ["sk-ant-api03-", 24],
    ["AKIA", 16],
    ["ghp_", 36],
    ["gho_", 36],
    ["github_pat_", 40],
    ["xoxb-", 30],
    ["npm_", 36]
  ])("S60: replaces a secret with the published prefix %s", (prefix, length) => {
    expect(text(`key=${fake(prefix, length)} rest`)).toBe("key=[redacted] rest");
  });

  it("S60: replaces a secret right after a JSON escape or URL encoding", () => {
    const secret = fake("sk-ant-api03-");
    expect(text(String.raw`{"text":"line\n${secret}"}`)).toBe(String.raw`{"text":"line\n[redacted]"}`);
    expect(text(String.raw`{"text":"\u0022${secret}"}`)).toBe(String.raw`{"text":"\u0022[redacted]"}`);
    expect(text(`?key%3D${secret}&x=1`)).toBe("?key%3D[redacted]&x=1");
    expect(text(`%22${fake("ghp_", 36)}%22`)).toBe("%22[redacted]%22");
  });

  it("S60: replaces a PEM private key block, and one cut off before its END line up to the end of its base64", () => {
    const begin = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
    const end = ["-----END", "PRIVATE", "KEY-----"].join(" ");
    expect(text(`a ${begin}\nMIIabc\n${end} b`)).toBe("a [redacted] b");
    expect(text(`a ${begin}\nMIIabc+/=\nQUJD`)).toBe("a [redacted]");
    expect(text(String.raw`{"key":"${begin}\nMIIabc\nQUJD","next":1}`)).toBe(String.raw`{"key":"[redacted]","next":1}`);
  });

  it("keeps words that only contain a prefix, and short values", () => {
    expect(text("task-abcdefgh1234 risk-assessment sk-short")).toBe("task-abcdefgh1234 risk-assessment sk-short");
  });

  it.each([
    ["sk_live_", 24],
    ["rk_test_", 24],
    ["glpat-", 20],
    ["hf_", 34],
    ["AIza", 35]
  ])("replaces a secret with the provider prefix %s", (prefix, length) => {
    expect(text(`key ${fake(prefix, length)} rest`)).toBe("key [redacted] rest");
  });

  it("keeps a provider prefix inside a word, inside a base64url blob, or before too few characters", () => {
    const kept = `desk_live_${"a".repeat(20)} shelf_hf_short hf_short AIzaShort glpat-short`;
    expect(text(kept)).toBe(kept);
    const blob = `ZfFC_Rray64GnGeN_AIza${"Q".repeat(35)}-hf_${"q".repeat(34)}_glpat-${"z".repeat(20)}`;
    expect(text(blob)).toBe(blob);
  });

  it("replaces a JWT, signed or not, and keeps text that only starts like one", () => {
    const part = (body: string) => `eyJ${body}`;
    const jwt = `${part("hbGciOiJIUzI1NiJ9")}.${part("zdWIiOiIxMjM0In0")}.${"Sig_-1".repeat(5)}`;
    expect(text(`token ${jwt} end`)).toBe("token [redacted] end");
    expect(text(`${part("hbGciOiJub25lIn0")}.${part("zdWIiOiIxIn0")}.`)).toBe("[redacted]");
    expect(text("eyJhbGciOiJIUzI1NiJ9 alone")).toBe("eyJhbGciOiJIUzI1NiJ9 alone");
  });

  it("replaces a Slack webhook URL", () => {
    const hook = ["https://hooks.slack.com/services", "T0000000", "B0000000", "X".repeat(24)].join("/");
    expect(text(`post to ${hook} now`)).toBe("post to [redacted] now");
    expect(text("see https://hooks.slack.com/services/ docs")).toBe("see https://hooks.slack.com/services/ docs");
  });

  it("replaces the value of a credential assignment and keeps its key", () => {
    expect(text("PASSWORD=hunter2 next")).toBe("PASSWORD=[redacted] next");
    expect(text("export DB_PASSWORD='s3cret value'")).toBe("export DB_PASSWORD='[redacted]'");
    expect(text(`{"client_secret": "abcd1234EFGH", "x": 1}`)).toBe(`{"client_secret": "[redacted]", "x": 1}`);
    expect(text(`{"password": "correcthorsebatterystaple"}`)).toBe(`{"password": "[redacted]"}`);
    expect(text(String.raw`{\"api_key\":\"abc123def\"}`)).toBe(String.raw`{\"api_key\":\"[redacted]\"}`);
    expect(text("X-Api-Key: 9f8e7d6c5b4a")).toBe("X-Api-Key: [redacted]");
    expect(text("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).toBe(
      "aws_secret_access_key = [redacted]"
    );
    expect(text(`"SecretAccessKey": "${"Ab1/".repeat(10)}"`)).toBe(`"SecretAccessKey": "[redacted]"`);
    expect(text("GITHUB_TOKEN=abc123&page=2")).toBe("GITHUB_TOKEN=[redacted]&page=2");
    expect(text(String.raw`line\npassword: p4ss`)).toBe(String.raw`line\npassword: [redacted]`);
    expect(text("SECRET_KEY=django-insecure-abc123")).toBe("SECRET_KEY=[redacted]");
    expect(text("MINIO_SECRET_KEY=minio123secret")).toBe("MINIO_SECRET_KEY=[redacted]");
    expect(text(`password: str = "hunter2abc"`)).toBe(`password: str = "[redacted]"`);
    expect(text(`const password: string = "hunter2abc";`)).toBe(`const password: string = "[redacted]";`);
    expect(text("password: Xk9mPq2rT=abcdefgh")).toBe("password: [redacted]");
    expect(text("<x>DB_PASSWORD=hunter2abc</x>")).toBe("<x>DB_PASSWORD=[redacted]</x>");
    expect(text("SMTP_PASSWORD=mail.pass1x")).toBe("SMTP_PASSWORD=[redacted]");
  });

  it("hides a quoted value holding the other quote or an escape, without running past its JSON string", () => {
    expect(text(String.raw`{"password":"p4ss\nword"}`)).toBe(String.raw`{"password":"[redacted]"}`);
    expect(text(`"password": "pa'ss1234"`)).toBe(`"password": "[redacted]"`);
    expect(text(String.raw`{"text":"password = \"abc123\" ok"}`)).toBe(
      String.raw`{"text":"password = \"[redacted]\" ok"}`
    );
    expect(text(String.raw`{"text":"password = \"abc123"}`)).toBe(String.raw`{"text":"password = \"[redacted]"}`);
  });

  it("hides a quoted credential that a preview cut before its closing quote", () => {
    expect(text(`{"password": "c0rrect horse`)).toBe(`{"password": "[redacted]`);
    expect(text(`password = "abcd1234\nnext line`)).toBe(`password = "[redacted]\nnext line`);
  });

  it("keeps assignments that name a type, a flag, a placeholder or code, and usage counts", () => {
    const kept = [
      "password: string;",
      "apiKey: string",
      `"secret": false`,
      "token = getToken()",
      "api_key = process.env.API_KEY",
      "password: z.string().min(8)",
      'token: "${{ secrets.GITHUB_TOKEN }}"',
      "PASSWORD=<your password>",
      "secret=****",
      `{"max_tokens": 4096, "input_tokens": 1200, "output_tokens": 35, "token_count": 12}`,
      "the token is: abc123",
      "token: 42",
      "token = base64.b64encode(raw)",
      "secret: corev1.Secret{}",
      "token = gen2()",
      // An unquoted value after a type annotation is a name in code, not a literal.
      "password: str = hunter2abc",
      "继续走 OIDC（`id-token: write`），见 v2 文档",
      String.raw`{\"TRAE_TOKEN\":\"env:TRAE_TOKEN\"}`,
      `{"input_cost_per_token": 0.000003, "output_cost_per_token": 1.5e-5}`,
      "const token = process.env.TOKEN!",
      "token = /API",
      `{"password": "Password", "token": "Token", "secret": "Show the secret"}`
    ];
    for (const value of kept) {
      expect(text(value)).toBe(value);
    }
  });

  it("replaces the credential after an authorization scheme", () => {
    expect(text("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer [redacted]");
    expect(text(`-H "authorization: basic dXNlcjpwYXNz"`)).toBe(`-H "authorization: basic [redacted]"`);
    expect(text(`{"Authorization":"Token abcdef12"}`)).toBe(`{"Authorization":"Token [redacted]"}`);
    expect(text(`curl -H "Bearer ${"a1".repeat(10)}"`)).toBe(`curl -H "Bearer [redacted]"`);
  });

  it("replaces a header that follows an escaped line break, as in raw JSONL", () => {
    expect(text(String.raw`GET / HTTP/1.1\r\nAuthorization: Basic dXNlcjpwYXNz\r\n`)).toBe(
      String.raw`GET / HTTP/1.1\r\nAuthorization: Basic [redacted]\r\n`
    );
    expect(text(String.raw`x\nBearer ${"a1".repeat(10)}`)).toBe(String.raw`x\nBearer [redacted]`);
    expect(text("xauthorization: Bearer abcdefgh12 notBearer abcdefghijklmnop1234")).toBe(
      "xauthorization: Bearer abcdefgh12 notBearer abcdefghijklmnop1234"
    );
  });

  it("keeps a scheme followed by prose or a variable", () => {
    const kept = [
      "Authorization: Bearer $TOKEN",
      "Authorization: Bearer ${API_TOKEN}",
      "the Bearer of bad news",
      "Bearer authentication is configured",
      "authorization: `Bearer ${token}`",
      "Authorization: Bearer <token>",
      "Authorization: Bearer …",
      "Authorization: Token a)"
    ];
    for (const value of kept) {
      expect(text(value)).toBe(value);
    }
  });

  it("replaces the password of URL userinfo and keeps the user name and host", () => {
    expect(text("postgres://admin:p4ssw0rd@db.local:5432/app")).toBe("postgres://admin:[redacted]@db.local:5432/app");
    expect(text("mongodb+srv://u:pw@cluster0.example.net")).toBe("mongodb+srv://u:[redacted]@cluster0.example.net");
    const kept = ["ssh://git@github.com/x.git", "http://localhost:3000/a@b", "postgres://u:${DB_PASS}@db"];
    for (const value of kept) {
      expect(text(value)).toBe(value);
    }
  });
});

describe("redact", () => {
  it("S60: copies a JSON value, redacting strings and object keys, without mutating it", () => {
    const secret = fake("sk-");
    const input = {
      cwd: `${home}/proj`,
      events: [{ text: `token ${secret} in ${home}/notes`, count: 2, ok: true, none: null }],
      [`${home}/proj/a.ts`]: 1,
      "-u-me-proj": "x"
    };
    const output = redact(input, { home });
    expect(output).toEqual({
      cwd: "~/proj",
      events: [{ text: "token [redacted] in ~/notes", count: 2, ok: true, none: null }],
      "~/proj/a.ts": 1,
      "~-proj": "x"
    });
    expect(input.cwd).toBe(`${home}/proj`);
    expect(JSON.stringify(output)).not.toContain("me/");
  });

  it("returns objects that are not plain data unchanged", () => {
    const date = new Date(0);
    const map = new Map([["k", `${home}/x`]]);
    const output = redact({ date, map }, { home });
    expect(output.date).toBe(date);
    expect(output.map).toBe(map);
  });
});
