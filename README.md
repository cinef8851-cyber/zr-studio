# ZR Studio — protótipo de construtor de sites

MVP de utilizador único, com uma interface para gerar páginas HTML com Gemini.

## Requisitos
- Node.js 20 ou superior
- Chave Gemini API configurada no servidor pela variável secreta GEMINI_API_KEY

## Executar

```sh
npm start
```

Nunca coloques a chave Gemini no HTML público, no GitHub ou em ficheiros commitados. Configura-a nos segredos privados do alojamento.

O MVP gera uma página HTML com CSS e JavaScript simples. Ainda não cria backends, bases de dados, autenticação, armazenamento persistente, projectos multi-ficheiro ou publicação dos projectos criados. Revê o código gerado antes de o usar em produção.
