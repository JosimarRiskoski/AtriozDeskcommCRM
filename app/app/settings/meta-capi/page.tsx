import { MetaCapiForm } from "./MetaCapiForm";
export const dynamic="force-dynamic";
export default function MetaCapiPage(){return <div className="flex h-full flex-col gap-6 overflow-y-auto p-6"><header><h1 className="text-2xl font-semibold">Conversões da Meta</h1><p className="text-sm text-muted-foreground">Quando um negócio for ganho, o servidor envia uma conversão única e auditável. Comece com o código de evento de teste.</p></header><MetaCapiForm/></div>}
