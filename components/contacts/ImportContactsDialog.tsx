"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_CONTACT_IMPORT_BYTES } from "@/lib/contacts/import-csv";

type PreviewRow = { row: number; name: string | null; phone: string | null; email: string | null;
  status: "valid" | "invalid" | "duplicate_file" | "existing"; reason: string | null };
type ImportResult = { total: number; created: number; existing: number; invalid: number; errors: number;
  rows: Array<{ row: number; status: string; reason: string | null }> };

export function ImportContactsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; total: number; ready: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() { setFile(null); setPreview(null); setResult(null); }
  function close(value: boolean) { if (busy) return; if (!value) reset(); onOpenChange(value); }
  async function submit(action: "preview" | "import") {
    if (!file) return toast.error("Selecione um arquivo CSV.");
    if (file.size > MAX_CONTACT_IMPORT_BYTES) return toast.error("O CSV deve ter até 2 MB.");
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("action", action);
      const response = await fetch("/api/v1/contacts/import", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Não foi possível importar o CSV.");
      if (action === "preview") {
        setPreview(json.data);
        setResult(null);
      } else {
        setResult(json.data);
        setPreview(null);
        await queryClient.invalidateQueries({ queryKey: ["contacts"] });
        toast.success(`${json.data.created} contato(s) criado(s).`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao ler o CSV.");
    } finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Importar contatos por CSV</DialogTitle>
        <DialogDescription>Confira a prévia antes de criar contatos. Nenhuma mensagem ou oportunidade será criada.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p>Colunas aceitas: <strong>nome, telefone, email</strong>. Telefone ou email é obrigatório. Até 250 contatos por arquivo.</p>
        <a className="text-primary underline" href="/modelos/modelo-contatos.csv" download>Baixar modelo CSV</a>
        <input aria-label="Arquivo CSV de contatos" type="file" accept=".csv,text/csv" disabled={busy}
          onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setResult(null); }} />
        {preview && <div className="space-y-2 rounded-md border p-3">
          <p><strong>{preview.ready}</strong> prontos para criar de <strong>{preview.total}</strong> linhas.
            As demais serão ignoradas. Contatos existentes não serão alterados.</p>
          <div className="max-h-56 overflow-auto">
            {preview.rows.map((row) => <div key={row.row} className="border-b py-1 last:border-0">
              Linha {row.row}: {row.name || row.phone || row.email || "sem identificação"} — {row.status === "valid" ? "pronto" : row.reason}
            </div>)}
          </div>
        </div>}
        {result && <div className="space-y-2 rounded-md border p-3" role="status">
          <p>Criados: {result.created} · Já existentes: {result.existing} · Inválidos: {result.invalid} · Erros: {result.errors}</p>
          {result.rows.filter((row) => row.status === "error").map((row) =>
            <p key={row.row} className="text-error-fg">Linha {row.row}: {row.reason}</p>)}
        </div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(false)} disabled={busy}>Fechar</Button>
        {!result && <Button variant="outline" onClick={() => submit("preview")} disabled={!file || busy}>
          {busy ? "Processando…" : "Validar e visualizar"}
        </Button>}
        {preview && preview.ready > 0 && <Button onClick={() => submit("import")} disabled={busy}>
          {busy ? "Importando…" : `Importar ${preview.ready} contato(s)`}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
