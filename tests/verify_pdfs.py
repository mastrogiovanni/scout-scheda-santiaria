"""Check actual PDF text independently of the JavaScript generator. Synthetic data only."""
from pathlib import Path
from zipfile import ZipFile
import re
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent
output = root / 'tmp/pdfs'
source = PdfReader(root / 'public/modello-originale.pdf')
normalize = lambda value: re.sub(r'\s+', '', value)

with ZipFile(output / 'basic.zip') as archive:
    (output / 'basic-compact.pdf').write_bytes(archive.read('scheda-compatta.pdf'))

for name in ['basic', 'complete', 'adult', 'guardian', 'long']:
    original = PdfReader(output / f'{name}-original.pdf')
    assert len(original.pages) >= 11
    for index, page in enumerate(source.pages):
        assert original.pages[index].extract_text().startswith(page.extract_text()), (name, index)
    compact = PdfReader(output / f'{name}-compact.pdf')
    compact_text = '\n'.join(page.extract_text() for page in compact.pages)
    original_text = '\n'.join(page.extract_text() for page in original.pages)
    for value in ['Giulia', 'Rossi', 'famiglia@example.org', 'SOCIO-123', '17/10/2026']:
        assert normalize(value) in normalize(compact_text), (name, value, 'compact')
        assert normalize(value) in normalize(original_text), (name, value, 'original')
    if name == 'basic':
        assert len(compact.pages) == 1, 'Simple form should fit one A4 page'
        assert len(original.pages) == 11
    if name == 'adult':
        assert 'NON PRESTA IL CONSENSO' in compact_text
        assert 'intervento chirurgico' not in compact_text
    if name == 'complete':
        assert len(compact.pages) == 2
        assert len(original.pages) == 11
        for text in ['LOTTO-123', 'Farmaco A', 'Farmaco B', 'Farmaco C', 'Farmaco D', 'Farmaco E', 'Zio', 'Controindicazione di esempio da riportare.']:
            assert normalize(text) in normalize(compact_text), text
            assert normalize(text) in normalize(original_text), text
    if name == 'long':
        for key in ['past', 'current', 'allergies', 'diet', 'doctorNotes', 'aids', 'updates']:
            assert 'FINE-' + key in compact_text, ('compact', key)
            assert 'FINE-' + key in original_text, ('original', key)
        assert len(original.pages) > 11

before = PdfReader(output / 'basic-original.pdf')
after = PdfReader(output / 'imported-original.pdf')
assert [p.extract_text() for p in before.pages] == [p.extract_text() for p in after.pages]
print('PASS: original 11-page contents preserved, expected compact lengths, all critical values and long-text endings retained, imported original matches.')
