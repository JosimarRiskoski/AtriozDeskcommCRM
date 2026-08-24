import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Política de Privacidade do Átrioz CRM.",
};

const UPDATED_AT = "24 de agosto de 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6">
      <article className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <header className="border-b border-border pb-6">
          <Link href="/login" className="text-sm font-medium text-accent hover:underline">
            ← Voltar ao Átrioz CRM
          </Link>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Política de Privacidade</h1>
          <p className="mt-2 text-sm text-muted-foreground">Última atualização: {UPDATED_AT}</p>
        </header>

        <div className="mt-8 space-y-8 text-sm leading-7 text-muted-foreground sm:text-base">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Sobre esta política</h2>
            <p className="mt-2">
              O Átrioz CRM é uma plataforma de relacionamento, atendimento e vendas utilizada por
              empresas para administrar contatos, conversas, oportunidades, campanhas, compromissos
              e agentes de inteligência artificial. Esta política explica, em linguagem clara, como
              os dados pessoais são tratados na operação da plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Quem trata os dados</h2>
            <p className="mt-2">
              A empresa que contratou o Átrioz CRM e se relaciona com o titular normalmente atua como
              controladora dos dados. O Átrioz CRM atua como operador, processando dados conforme as
              instruções dessa empresa, e como controlador dos dados necessários à administração,
              segurança e contratação da própria plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">3. Dados que podem ser tratados</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>identificação e contato, como nome, telefone, e-mail e empresa;</li>
              <li>mensagens, arquivos e registros de atendimento enviados pelos canais integrados;</li>
              <li>informações comerciais, oportunidades, tarefas, compromissos e preferências;</li>
              <li>registros técnicos de acesso, segurança, auditoria e funcionamento das integrações;</li>
              <li>consentimentos, recusas de comunicação e solicitações relacionadas à LGPD.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Finalidades</h2>
            <p className="mt-2">
              Os dados podem ser usados para prestar atendimento, registrar o relacionamento com o
              cliente, executar comunicações autorizadas, organizar vendas e compromissos, operar
              recursos de IA configurados pela empresa usuária, prevenir fraudes, manter a segurança,
              cumprir obrigações legais e melhorar a confiabilidade do serviço.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Compartilhamento</h2>
            <p className="mt-2">
              O tratamento pode envolver fornecedores essenciais de infraestrutura, banco de dados,
              mensageria, e-mail, agenda, inteligência artificial e monitoramento. O acesso é limitado
              ao necessário para a finalidade contratada. Dados também podem ser fornecidos quando
              houver obrigação legal ou ordem de autoridade competente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Retenção e segurança</h2>
            <p className="mt-2">
              Os dados são mantidos pelo período necessário ao serviço, às finalidades informadas e às
              obrigações legais. A organização usuária pode definir prazos de retenção de mídia. São
              adotados controles de acesso, isolamento entre organizações, auditoria e proteção de
              credenciais, sem prejuízo de medidas adicionais exigidas pela operação do cliente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Direitos do titular</h2>
            <p className="mt-2">
              O titular pode solicitar confirmação do tratamento, acesso, correção, anonimização,
              bloqueio, eliminação, portabilidade, informação sobre compartilhamentos, revisão de
              decisões automatizadas e revogação do consentimento, quando aplicável. A solicitação deve
              ser feita à empresa com a qual o titular mantém relacionamento ou pelo canal de
              privacidade indicado por ela.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">8. Inteligência artificial</h2>
            <p className="mt-2">
              Quando habilitada, a IA pode analisar o contexto autorizado para sugerir ou produzir
              respostas e apoiar tarefas. A empresa usuária define agentes, fontes de conhecimento,
              limites e situações de atendimento humano. Informações sensíveis ou decisões de impacto
              relevante devem seguir revisão e regras humanas definidas pela organização.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">9. Contato e atualizações</h2>
            <p className="mt-2">
              Dúvidas e solicitações devem ser encaminhadas ao DPO ou canal oficial informado pela
              empresa responsável pelo atendimento. Esta política poderá ser atualizada para refletir
              alterações legais, operacionais ou tecnológicas; a data da versão vigente será sempre
              exibida no início desta página.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
