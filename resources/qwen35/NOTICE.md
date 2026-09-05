# Qwen 3.5 tokenizer resources

The tokenizer files in this directory are sourced from
[`Qwen/Qwen3.5-9B`](https://huggingface.co/Qwen/Qwen3.5-9B) at revision
`c202236235762e1c871ad0ccb60c8ee5ba337b9a` and are licensed under Apache-2.0.

Original files and SHA-256 hashes before deterministic gzip compression:

- `tokenizer.json`: `5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42`
- `tokenizer_config.json`: `316230d6a809701f4db5ea8f8fc862bc3a6f3229c937c174e674ff3ca0a64ac8`

The files are loaded locally at runtime; NAIS3 does not download tokenizer
resources or send prompt text to an external tokenizer service.
