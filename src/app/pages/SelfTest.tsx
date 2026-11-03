// Ed25519 の試験のページ：橋渡し（Node の crypto）の署名を、このブラウザの WebCrypto で検証する。
import { Alert, Anchor, Container, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import { TEXT } from "../text";

interface Sample {
  publicKeyJwk: JsonWebKey;
  message: string;
  tamperedMessage: string;
  signature: string;
  nodeVersion: string;
}

type Outcome = { kind: "running" } | { kind: "done"; valid: boolean; tampered: boolean } | { kind: "error"; name: string };

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 橋渡しの見本を受け、WebCrypto で 2 つの文を検証する。 */
export async function verifySample(s: Sample): Promise<{ valid: boolean; tampered: boolean }> {
  const key = await crypto.subtle.importKey("jwk", s.publicKeyJwk, { name: "Ed25519" }, false, ["verify"]);
  const sig = fromB64url(s.signature);
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, sig, fromB64url(s.message));
  const tampered = await crypto.subtle.verify({ name: "Ed25519" }, key, sig, fromB64url(s.tamperedMessage));
  return { valid, tampered };
}

function browserName(): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData?.brands;
  const named = brands?.filter((b) => !/not.?a.?brand/i.test(b.brand) && b.brand !== "Chromium");
  if (named && named.length) return named.map((b) => `${b.brand} ${b.version}`).join(", ");
  return navigator.userAgent;
}

export function SelfTest() {
  const [o, setO] = useState<Outcome>({ kind: "running" });
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(ROUTES.selftestEd25519.path, { cache: "no-store" });
        const r = await verifySample((await res.json()) as Sample);
        setO({ kind: "done", ...r });
      } catch (e) {
        setO({ kind: "error", name: e instanceof Error ? e.name : "Error" });
      }
    })();
  }, []);

  const pass = o.kind === "done" && o.valid && !o.tampered;
  const cell = (v: boolean) => <span className={v ? "moyai-ok" : "moyai-ng"}>{v ? TEXT.selftest.verified : TEXT.selftest.rejected}</span>;

  return (
    <Container size="md" py="lg">
      <Stack>
        <Title order={2}>{TEXT.selftest.title}</Title>
        <Text>{TEXT.selftest.lead}</Text>
        <Text size="sm" c="dimmed" data-testid="browser">
          {TEXT.selftest.browser}：{browserName()}
        </Text>
        {o.kind === "running" && <Text>{TEXT.selftest.running}</Text>}
        {o.kind === "error" && (
          <Alert color="red" data-testid="selftest-result" data-pass="false">
            {TEXT.selftest.error(o.name)}
          </Alert>
        )}
        {o.kind === "done" && (
          <>
            <Table withTableBorder>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>{TEXT.selftest.validLabel}</Table.Td>
                  <Table.Td data-testid="valid">{cell(o.valid)}</Table.Td>
                  <Table.Td c="dimmed">{TEXT.selftest.expectValid}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{TEXT.selftest.tamperedLabel}</Table.Td>
                  <Table.Td data-testid="tampered">{cell(o.tampered)}</Table.Td>
                  <Table.Td c="dimmed">{TEXT.selftest.expectRejected}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
            <Alert color={pass ? "teal" : "red"} data-testid="selftest-result" data-pass={String(pass)}>
              {pass ? TEXT.selftest.pass : TEXT.selftest.fail}
            </Alert>
          </>
        )}
        <Anchor href={APP_PAGES.home}>{TEXT.selftest.back}</Anchor>
      </Stack>
    </Container>
  );
}
