Extension keyword badge slim chips:

- Symptom: keyword chips in the in-page keyword matrix could render with a puffy pill shape, wasting vertical space in dense keyword lists.
- Fix: keep the chip geometry explicit and compact: low line-height, small vertical padding, modest icon gap, and a small drag handle. Avoid text or icon changes that increase chip height unless the matrix layout is intentionally redesigned.
- Guardrail: the matrix should favor density over touch-target comfort because it may need to show every scraped keyword without hidden caps.
