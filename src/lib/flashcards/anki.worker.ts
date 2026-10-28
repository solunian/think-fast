import { unzipSync } from 'fflate';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
	try {
		let total = 0;
		let fileCount = 0;
		const files = unzipSync(new Uint8Array(event.data), {
			filter: (f) => {
				total += f.originalSize;
				if (++fileCount > 10000) throw new Error('Package exceeds 10,000 files.');
				if (total > 100 * 1024 * 1024 || f.name.includes('..') || f.name.startsWith('/'))
					throw new Error('Unsafe archive path or decompressed package exceeds 100 MB.');
				return f.name === 'collection.anki2' || f.name === 'collection.anki21';
			}
		});
		if (Object.keys(files).length > 10000)
			throw new Error('Package contains too many files (limit 10,000).');
		const collection = files['collection.anki21'] ?? files['collection.anki2'];
		if (!collection)
			throw new Error(
				'This package format is not supported. Re-export from Anki with “Support older Anki versions” enabled.'
			);
		const SQL = await initSqlJs({ locateFile: () => wasmUrl });
		const db = new SQL.Database(collection);
		try {
			const metadata = db.exec('SELECT models FROM col')[0]?.values[0]?.[0];
			if (typeof metadata !== 'string') throw new Error('Unsupported collection metadata.');
			const models = JSON.parse(metadata) as Record<
				string,
				{ type: number; flds: { name: string }[]; tmpls: { qfmt: string; afmt: string }[] }
			>;
			for (const model of Object.values(models)) {
				if (model.type !== 0 && model.type !== 1) throw new Error('Unsupported note type.');
				if (model.type === 0 && (model.flds.length !== 2 || model.tmpls.length > 2))
					throw new Error(
						'Custom multi-field templates are unsupported. Export these notes as CSV with rendered front/back fields.'
					);
				if (
					model.tmpls.some((t) => /script|iframe|type:|tts|image-occlusion/i.test(t.qfmt + t.afmt))
				)
					throw new Error('This deck uses an unsupported interactive template.');
			}
			const result = db.exec(
				'SELECT notes.flds, cards.ord FROM notes JOIN cards ON cards.nid=notes.id ORDER BY cards.id'
			);
			if (!result[0]?.values.length) throw new Error('The package contains no supported cards.');
			const cards = result[0].values.map((row) => {
				const fields = String(row[0]).split('\x1f');
				const ordinal = Number(row[1]);
				if (fields[0].includes('{{c')) {
					const front = fields[0].replace(
						/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs,
						(_, n, answer, hint) => (Number(n) === ordinal + 1 ? '[' + (hint || '…') + ']' : answer)
					);
					const back =
						fields[0].replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/gs, '$1') +
						(fields[1] ? '\n' + fields[1] : '');
					return { front, back };
				}
				if (fields.length < 2)
					throw new Error('Unsupported note: at least two fields are required.');
				return { front: fields[ordinal === 1 ? 1 : 0], back: fields[ordinal === 1 ? 0 : 1] };
			});
			self.postMessage({
				cards,
				warnings: [
					'Fresh learning only. Templates, deck hierarchy, tags, and attachments are not imported. HTML is displayed as text. Verify the preview before importing.'
				]
			});
		} finally {
			db.close();
		}
	} catch (e) {
		self.postMessage({ error: e instanceof Error ? e.message : String(e) });
	}
};
