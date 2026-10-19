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
    assert archive.namelist() == ['scheda.json'], 'Parent export must contain data only'

for name in ['basic', 'complete', 'adult', 'guardian', 'long']:
    original = PdfReader(output / f'{name}-original.pdf')
    assert len(original.pages) >= 11
    for index, page in enumerate(source.pages):
        assert original.pages[index].extract_text().startswith(page.extract_text()), (name, index)
    compact = PdfReader(output / f'{name}-compact.pdf')
    compact_text = '\n'.join(page.extract_text() for page in compact.pages)
    original_text = '\n'.join(page.extract_text() for page in original.pages)
    for value in ['Giulia', 'Rossi', 'famiglia@example.org', 'SOCIO-123']:
        assert normalize(value) in normalize(compact_text), (name, value, 'compact')
        assert normalize(value) in normalize(original_text), (name, value, 'original')
    if name == 'basic':
        assert len(compact.pages) == 1, 'Simple form should fit one A4 page'
        assert len(original.pages) == 11
    for excluded in ['Dichiarazioni', 'Consenso al trattamento', 'PRESTA IL CONSENSO', 'Firma del', 'Firma di', 'Da firmare', 'Firmatari', 'Il/la minore non presenta', 'Chiedono', 'esonerandoli']:
        assert excluded not in compact_text, (name, excluded)
    assert '17/10/2026' in original_text
    if name == 'complete':
        assert len(compact.pages) == 1, 'Data-only complete form should fit one A4 page'
        assert len(original.pages) == 11
        for text in ['LOTTO-123', 'Farmaco A', 'Farmaco B', 'Farmaco C', 'Farmaco D', 'Farmaco E', 'Zio', 'Controindicazione di esempio da riportare.']:
            assert normalize(text) in normalize(compact_text), text
            assert normalize(text) in normalize(original_text), text
    if name == 'long':
        for key in ['past', 'current', 'allergies', 'diet', 'doctorNotes', 'aids', 'updates']:
            assert 'FINE-' + key in compact_text, ('compact', key)
            assert 'FINE-' + key in original_text, ('original', key)
        assert len(original.pages) > 11

group = PdfReader(output / 'group-reduced.pdf')
pages = [page.extract_text() for page in group.pages]
assert 'Giulia Rossi' in pages[0] and 'FINE-past' not in pages[0]
assert 'FINE-past' in ''.join(pages[1:-1]), 'Long sheet must start after the first scout'
assert 'Luisa Verdi' in pages[-1] and all('Luisa Verdi' not in text for text in pages[:-1])
assert all('SCHEDA SANITARIA' in text and '2027-2028' in text for text in pages)
assert all('Firma del' not in text and 'Dichiarazioni' not in text for text in pages)
assert all(text.strip() for text in pages), 'No blank trailing or separator pages'

before = PdfReader(output / 'basic-original.pdf')
after = PdfReader(output / 'imported-original.pdf')
assert [p.extract_text() for p in before.pages] == [p.extract_text() for p in after.pages]
print('PASS: original 11-page contents preserved, expected compact lengths, all critical values and long-text endings retained, imported original matches.')
