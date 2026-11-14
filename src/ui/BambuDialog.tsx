import { useState } from 'react';
import { useApp } from '../state/store';
import { Dialog } from './Dialog';
import { buildExport, download, exportBodyIds } from '../io/fileOps';
import { bedProblems } from './Viewport';
import { fmt } from '../model/math';

type Platform = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'other';
}

/** Przesunięcie ustawiające modele na środku stołu Bambu (układ stołu 0…X, 0…Y) ze spodem w Z=0. */
export function bambuOffset(ids: string[]): [number, number, number] | null {
  const st = useApp.getState();
  const bbs = ids.map((id) => st.bodies[id]?.bbox).filter(Boolean) as { min: number[]; max: number[] }[];
  if (!bbs.length) return null;
  const min = [0, 1, 2].map((i) => Math.min(...bbs.map((b) => b.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...bbs.map((b) => b.max[i])));
  const p = st.doc.printer;
  return [p.x / 2 - (min[0] + max[0]) / 2, p.y / 2 - (min[1] + max[1]) / 2, -min[2]];
}

const STEPS: Record<Platform, string[]> = {
  windows: [
    'Kliknij pobrany plik .3mf na pasku pobierania przeglądarki – jeśli przy instalacji Bambu Studio skojarzono z nim pliki 3MF, otworzy się od razu.',
    'Jeśli otworzy się inny program: w Eksploratorze kliknij plik prawym przyciskiem → Otwórz za pomocą → Bambu Studio (zaznacz „Zawsze używaj tej aplikacji”).',
    'Można też przeciągnąć plik na okno Bambu Studio albo użyć Plik → Importuj (Ctrl+I).',
  ],
  mac: [
    'Otwórz folder Pobrane, kliknij plik .3mf prawym przyciskiem → Otwórz za pomocą → Bambu Studio.',
    'Albo przeciągnij plik na ikonę Bambu Studio w Docku lub na jego okno.',
  ],
  linux: [
    'Przeciągnij pobrany plik na okno Bambu Studio albo użyj Plik → Importuj (Ctrl+I).',
    'Z terminala: uruchom Bambu Studio z plikiem jako argumentem, np. „./Bambu_Studio.AppImage ~/Pobrane/projekt.3mf” (Bambu Studio przyjmuje ścieżki plików w wierszu poleceń).',
  ],
  android: [
    'Bambu Studio działa tylko na komputerze. Wyślij plik na komputer (przycisk „Udostępnij” poniżej – np. e-mail, chmura, komunikator) i otwórz go tam w Bambu Studio.',
  ],
  ios: [
    'Bambu Studio działa tylko na komputerze. Użyj przycisku „Udostępnij”, aby wysłać plik na komputer (AirDrop, iCloud Drive, e-mail) i otwórz go tam w Bambu Studio.',
  ],
  other: ['Otwórz pobrany plik .3mf w Bambu Studio (Plik → Importuj albo przeciągnij plik na okno programu).'],
};

export function BambuDialog() {
  const platform = detectPlatform();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; data: Uint8Array } | null>(null);
  const problemsText = useApp((s) => bedProblems(s).join('; '));
  const printer = useApp((s) => s.doc.printer);
  const close = () => useApp.getState().setDialog(null);
  const ids = exportBodyIds(false);
  const st = useApp.getState();
  const total = (() => {
    const bbs = ids.map((id) => st.bodies[id]?.bbox).filter(Boolean) as { min: number[]; max: number[] }[];
    if (!bbs.length) return null;
    return [0, 1, 2].map((i) => Math.max(...bbs.map((b) => b.max[i])) - Math.min(...bbs.map((b) => b.min[i])));
  })();
  const tooBig = total ? total[0] > printer.x + 0.01 || total[1] > printer.y + 0.01 || total[2] > printer.z + 0.01 : false;

  const make = async () => {
    setBusy(true);
    try {
      const off = bambuOffset(ids);
      if (!off) throw new Error('Brak widocznych brył do wysłania');
      const f = await buildExport('3mf', { bodyIds: ids, quality: 'normal', offset: off });
      const data = f.data as Uint8Array;
      download(f.name, data, f.mime);
      setFile({ name: f.name, data });
      useApp.getState().notify(`Pobrano ${f.name} – otwórz go w Bambu Studio`, 'ok');
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator;

  return (
    <Dialog title="Otwórz w Bambu Studio" onClose={close} wide>
      <p>
        Model zostanie zapisany jako <b>3MF w milimetrach</b>, ułożony na środku stołu {fmt(printer.x)} × {fmt(printer.y)} mm, spodem na płycie (Z = 0).
      </p>
      {total && (
        <div className={tooBig ? 'error-box' : 'info'} data-testid="bambu-size">
          Wymiary modelu: {total.map((v) => fmt(v)).join(' × ')} mm{tooBig ? ` – nie mieści się w obszarze roboczym ${printer.x} × ${printer.y} × ${printer.z} mm!` : ' – mieści się w obszarze roboczym.'}
        </div>
      )}
      {!tooBig && problemsText && <div className="note">{problemsText} (w pliku 3MF model zostanie przesunięty na środek stołu).</div>}
      <button className="primary" data-testid="bambu-download" disabled={busy || !ids.length} onClick={make}>
        {busy ? 'Przygotowywanie…' : 'Pobierz plik 3MF dla Bambu Studio'}
      </button>
      {file && canShare && (
        <button
          onClick={async () => {
            const f = new File([file.data as BlobPart], file.name, { type: 'model/3mf' });
            try {
              if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: file.name });
              else useApp.getState().notify('Ta przeglądarka nie udostępnia plików – użyj pobranego pliku', 'error');
            } catch {
              /* anulowano */
            }
          }}
        >
          Udostępnij plik…
        </button>
      )}
      <h3>Jak otworzyć plik ({platformName(platform)})</h3>
      <ol className="steps">
        {STEPS[platform].map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <details>
        <summary>Dlaczego nie otwiera się automatycznie?</summary>
        <p className="muted">
          Bambu Studio przyjmuje pliki z przeglądarki przez odnośniki <code>bambustudio://open?file=&lt;adres&gt;</code> (Windows, Linux) oraz{' '}
          <code>bambustudioopen://&lt;adres&gt;</code> (macOS). W obu przypadkach program sam <b>pobiera plik spod adresu http(s)</b> (tak działa przycisk na
          MakerWorld). Ta aplikacja działa w całości w przeglądarce, bez serwera – wygenerowany plik istnieje tylko w pamięci przeglądarki i nie ma adresu
          http(s), który Bambu Studio mogłoby pobrać (adresy <code>blob:</code> są widoczne tylko dla przeglądarki). Wysyłanie Twojego modelu na obcy serwer
          tylko po to, żeby uzyskać adres, byłoby niezgodne z zasadą „wszystko lokalnie”. Dlatego plik jest pobierany, a Bambu Studio otwiera go z dysku –
          tak samo jak przy argumencie wiersza poleceń <code>bambu-studio plik.3mf</code>.
        </p>
      </details>
    </Dialog>
  );
}

function platformName(p: Platform) {
  return { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS / iPadOS', other: 'komputer' }[p];
}
