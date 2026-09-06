# Casal LOVE — Design (v0.1)

App mediador para casais, com IA de nome **LOVE**. Mediação técnica, sem se apresentar como psicóloga/terapeuta. Objetivo: preservar o casamento com saúde. Em casos de abuso/violência, acolhe e encaminha a autoridades — não media.

## 1. Personas

- **Cônjuge A / Cônjuge B** — contas individuais vinculadas ao par.
- **Terapeuta credenciado (v2)** — paga mensalidade, aparece no marketplace.
- **Admin** — gestão de conteúdo e moderação.

## 2. Módulos e regras

### 2.1 Onboarding
- Cadastro + 2FA.
- Vínculo de casal por convite/aceite (só existe casal com aceite mútuo).
- Questionário base: tempo juntos, filhos, moradia, linguagens do amor, notas 0-10 nos 7 pilares.
- Preferências: religião (opt-in), política, temas evitados.
- Triagem de segurança (violência, ideação suicida, substâncias) — se positivo, desvia para "modo cuidado", sem mediação.
- Termo LGPD + disclaimer ("LOVE não é psicóloga/terapeuta").
- Regra: IA só cruza dados dos dois quando ambos concluírem onboarding.

### 2.2 Check-in diário
- 1x/dia, horário escolhido.
- Conversa curta: como foi o dia, momento de estresse com o parceiro (intensidade 1-10, pilar), momento bom, opcional: dia de intimidade, dia de "date".
- Dados são individuais; parceiro não vê. Alimentam índice do casal e detecção de padrões.

### 2.3 Modo conflito
1. Coleta (o quê, como, onde, o que entendeu).
2. Escala de intensidade.
3. Se ≥ 7, oferece "modo esfriar" (respiração + timer).
4. Reformulação em CNV.
5. Fundamentação via RAG com **citação obrigatória**.
6. Sugestões (nunca ordens).
7. Se autorizado, aciona a ponte (§2.4).

Regras invioláveis: não julga, não acusa, não diagnostica, não sugere separação (exceto risco à vida), não fala como psicóloga. Detectou risco → botão de emergência (CVV 188, 180, 192, 190).

### 2.4 Ponte entre parceiros (consentimento por blocos)
- Resumo em blocos → A aprova/edita/remove bloco a bloco.
- Blocos aprovados formam "resumo autorizado".
- LOVE aborda B em tom consultivo, sem mostrar o resumo (para não gerar defensiva).
- B dá sua versão. LOVE cruza e volta a mediar cada um. Se não resolver, sugere sessão em grupo (v2).

### 2.5 Journal privado
Isolado por usuário. Nunca compartilhado.

### 2.6 Sessão semanal do casal (v1.5)
Chat guiado a três ou sala de voz. Regras de fala (tempo, ordem). Saída: tarefas + nota no índice.

### 2.7 Tarefas do casal
Baseadas nos pilares e nas linguagens do amor. Alimentam o índice.

### 2.8 Rituais e exercícios
Biblioteca (36 perguntas de Aron, gratidão, plano financeiro, mapa de intimidade, etc.).

### 2.9 Índice de saúde + gráficos
Índice 0-100 geral e por pilar; gráficos de atritos, momentos bons/ruins, intimidade, tarefas, linguagens do amor.

### 2.10 Botão de emergência
Sempre visível. Modal com CVV 188, 180, 192, 190.

### 2.11 Preferências e privacidade
- Ligar/desligar temas.
- Apagar histórico (parcial/total).
- Retenção máxima 12 meses.
- Exportar dados (LGPD).
- Desvincular do casal.

### 2.12 Marketplace de terapeutas (v2)
Aba de credenciados. Receita = mensalidade dos terapeutas.

### 2.13 Modo separação
IA sempre tenta reconciliar (exceto abuso/violência). Se pessoa insiste, faz perguntas para dar clareza; não valida. Se decisão for tomada, orienta comunicação respeitosa e recomenda profissional.

## 3. Regras da IA "LOVE" (system prompt + guardrails)

1. Identidade explícita como mediadora, não terapeuta.
2. Estatística só com fonte citada do RAG.
3. Tom acolhedor, calmo, consultivo.
4. Sugere; não decide.
5. Sem manipulação (culpa, medo, pressão).
6. Neutralidade entre os parceiros.
7. Confidencialidade cruzada (nada vaza sem consentimento por bloco).
8. Respeita temas evitados por usuário.
9. Detecção de risco separada do LLM (regras determinísticas + classificador).
10. Nunca sugere separação (exceto risco à vida).
11. Não dá conselho jurídico, médico ou financeiro específico.

## 4. Frontend — telas

Splash/Onboarding, Home, Chat com LOVE, Sala de voz, Journal, Consentimento por blocos, Tarefas, Rituais, Painel de saúde, Perfil, Marketplace (v2).

## 5. Backend — serviços

Auth, Couples, Profile, Journal, Check-in, Conflict, Session, Tasks, Rituals, Health Index, AI Orchestrator, RAG, Safety, Consent Log, Retention, Billing, Notifications, Admin, Marketplace (v2).

## 6. Modelo de dados (alto nível)

`User`, `Couple`, `Profile`, `Consent`, `SafetyScreening`, `CheckIn`, `Event`, `Conflict`, `Block`, `JournalEntry`, `Session`, `Task`, `RitualCompletion`, `HealthScore`, `Message`, `Source`, `EmergencyEvent`, `AuditLog`.

**Segregação crítica:** `Journal` e `CheckIn` isolados por usuário. Só `Block` aprovados podem cruzar.

## 7. Segurança e LGPD

TLS + criptografia em repouso; 2FA; retenção máx. 12 meses; direito de exportar e apagar; log de consentimentos; detecção de risco fora do LLM; disclaimers em contextos-chave; sem coleta de foto/RG/CPF na v1; termos revisados por advogado antes do lançamento.

## 8. Stack técnica (aprovada)

- **Runtime:** Node.js + TypeScript
- **HTTP:** Fastify
- **DB:** PostgreSQL (com extensão `pgvector`)
- **ORM:** Prisma
- **Auth:** próprio (argon2 + JWT + 2FA via Twilio)
- **LLM:** Anthropic Claude (Sonnet + Haiku)
- **Embeddings:** OpenAI ou Voyage
- **Fila/Jobs:** BullMQ + Redis
- **Testes:** Vitest
- **Observabilidade:** pino + Sentry
- **Deploy:** Fly.io ou Railway (fase posterior)

## 9. Escopo MVP (v1)

1. Cadastro + 2FA + vínculo de casal
2. Onboarding completo
3. Check-in diário
4. Modo conflito com ponte por blocos
5. Journal privado
6. Tarefas do casal (simples)
7. Índice de saúde básico + 2-3 gráficos
8. Botão de emergência
9. RAG com fontes citáveis dos 7 pilares
10. Preferências, apagar histórico, retenção
11. Assinatura paga

**v1.5 / v2:** sessão semanal por voz, rituais avançados, gráficos completos, marketplace, modo separação estruturado.

## 10. Riscos principais e mitigações

| Risco | Mitigação |
|---|---|
| Violência não detectada | Triagem + detector determinístico + botão de emergência + IA não media |
| Vazamento de dados sensíveis | Criptografia, muralha entre perfis, purga em 12m, log de acessos |
| CFP 011/2018 | Disclaimer explícito, revisão jurídica |
| LLM alucinando estatística | RAG obrigatório com citação de fonte |
| Coerção entre parceiros | Fora do escopo técnico; garantia mínima é 2FA + apagar histórico |
| Viés religioso | Opt-in por usuário |
| Manipulação por monetização | Pago, sem freemium; nunca ofertar em crise |
| Impersonação | 2FA + aceite mútuo do casal |
