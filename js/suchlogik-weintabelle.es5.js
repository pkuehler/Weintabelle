/* suchlogik-weintabelle.es5.js (ES5 Drop-in) */
(function () {
    // ===== DOM =====
    var table = document.getElementById('orders');
    var thead = table ? table.tHead: null;
    var tbody = table && table.tBodies && table.tBodies[0] ? table.tBodies[0]: null;
    var noResultsCell = document.getElementById('noResults');
    var searchInput = document.getElementById('tableSearch');
    var clearBtn = document.getElementById('clearSearch');
    var resultInfo = document.getElementById('resultInfo');
    var pageSizeSel = document.getElementById('pageSize');
    var pageInfo = document.getElementById('pageInfo');
    var pageNumbers = document.getElementById('pageNumbers');
    
    // ===== Konfig / Flags =====
    var DEBUG_GUARDS = false; // optionales Logging
    var TRINKBAR_STRIKT = true; // true=strikt, false=kulant
    
    // Proxy-Logik für Vergleiche auf Trinkreife-Start/-Ende ein/aus
	// false = strikte Logik (Status quo), true = "ab"/"bis" werden als Proxy akzeptiert
	var TRINKREIFE_PROXY = true;
    
    // ===== Tabellen-Metadaten =====
    var ths = thead ?[].slice.call(thead.querySelectorAll('th')):[];
    var colTypes =[];
    for (var ct = 0; ct < ths.length; ct++) {
        colTypes.push(ths[ct].getAttribute('data-type') || 'string');
        if (ths[ct].classList && ths[ct].classList.contains('sortable')) {
            ths[ct].setAttribute('tabindex', '0');
            ths[ct].setAttribute('role', 'button');
            ths[ct].setAttribute('aria-sort', 'none');
        }
    }
    var htmlCols = {
        1: true
    };
    // Château-Spalte enthält HTML
    
    // ===== Daten / Status =====
    var data =[]; // {id, cells:[...]}
    var filtered =[]; // Indexe in data
    var pageSize = pageSizeSel ? Number(pageSizeSel.value || 25): 25;
    var currentPage = 1;
    
    // ===== Autocomplete-Globals (ohne Initialisierung) =====
    var uniqChateau = [];
    var uniqAppellation = [];
    
    // ===== Utils =====
    function stripHTML(s) {
        return String(s).replace(/<[^>]*>/g, ' ');
    }
    function decodeEntities(s) {
        var ta = document.createElement('textarea');
        ta.innerHTML = String(s);
        return ta.value;
    }
    function visibleText(s) {
        return decodeEntities(stripHTML(s)).replace(/\s+/g, ' ').trim();
    }
    function normalize(s) {
        s = String(s).toLowerCase();
        // einfache Diakritika-Entfernung (ES5)
        var map = {
            'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'ā': 'a',
            'ç': 'c', 'č': 'c',
            'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e', 'ē': 'e',
            'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i', 'ī': 'i',
            'ñ': 'n',
            'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o', 'ō': 'o',
            'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ū': 'u',
            'ý': 'y', 'ÿ': 'y',
            'œ': 'oe', 'æ': 'ae', 'ß': 'ss'
        };
        s = s.replace(/[^\u0000-\u007E]/g, function (ch) {
            return map[ch] || ch;
        });
        s = s.replace(/[-\u2010-\u2015'’`]/g, ' ').replace(/\s+/g, ' ').trim();
        return s;
    }
    function exactCanon(s) {
        return normalize(s).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function canonPhrase(s) {
        return exactCanon(s);
    }
    function headerText(th, i) {
        var t = th.textContent || ('Spalte ' + (i + 1));
        return t.replace(/\s+▲?▼?/g, '').trim();
    }
    
    // ===== Kolonnen-Mapping (ES5 Object statt Map) =====
    var colSlugToIndex = {
    };
    (function () {
        for (var i = 0; i < ths.length; i++) {
            var slug = exactCanon(headerText(ths[i], i)).replace(/\s+/g, '');
            colSlugToIndex[slug] = i;
        }
        colSlugToIndex[ 'jahr'] = 0; colSlugToIndex[ 'jahrgang'] = 0;
        colSlugToIndex[ 'chateau'] = 1; colSlugToIndex[ 'weingut'] = 1;
        colSlugToIndex[ 'appellation'] = 2;
        colSlugToIndex[ 'bewertung'] = 3;
        colSlugToIndex[ 'trinkreife'] = 4;
        colSlugToIndex[ 'anzahl'] = 5;
    })();
    
    // ===== Virtuelle Felder =====
    var V_TR_START = -1, V_TR_ENDE = -2, V_REGION = -3, V_TRINKBAR = -4;
    
    colSlugToIndex[ 'trinkreifestart'] = V_TR_START;
    colSlugToIndex[ 'trinkreife_start'] = V_TR_START;
    colSlugToIndex[ 'trinkreifeanfang'] = V_TR_START;
    
    colSlugToIndex[ 'trinkreifeende'] = V_TR_ENDE;
    colSlugToIndex[ 'trinkreife_ende'] = V_TR_ENDE;
    colSlugToIndex[ 'trinkreifeend'] = V_TR_ENDE;
    
    colSlugToIndex[ 'region'] = V_REGION; // ⬅︎ wichtig
    // „trinkreife:jetzt“
    colSlugToIndex[ 'trinkreife'] = colSlugToIndex[ 'trinkreife'] || 4; // real column
    // Spezialwert „jetzt“ wird im makeTerm/ evalTerm behandelt
    
    // ===== Appellation-Kanonisierung + Regionen =====
    function canon(s) {
        s = normalize(s);
        s = s.replace(/\bst[.]?\b/g, 'saint').replace(/\bste[.]?\b/g, 'sainte').replace(/\bsaintemilion\b/g, 'saint emilion').replace(/\bmoulis-en-medoc\b/g, 'moulis en medoc').replace(/\blistrac-medoc\b/g, 'listrac medoc').replace(/\bhaut[-\s]?medoc\b/g, 'haut medoc').replace(/\bpessac[-\s]?leognan\b/g, 'pessac leognan').replace(/\bblaye-cotes-de-bordeaux\b/g, 'blaye cotes de bordeaux').replace(/\bfrancs-cotes-de-bordeaux\b/g, 'francs cotes de bordeaux').replace(/\bcastillon-cotes-de-bordeaux\b/g, 'castillon cotes de bordeaux').replace(/\bcadillac-cotes-de-bordeaux\b/g, 'cadillac cotes de bordeaux').replace(/\bpremieres-cotes-de-bordeaux\b/g, 'premieres cotes de bordeaux').replace(/\bsainte-foy-bordeaux\b/g, 'sainte foy bordeaux');
        return s;
    }
    
    function isRegionKey(raw) {
        if (! raw) return false;
        var key = canon(String(raw)).replace(/\s+/g, '_');
        return key === 'linkes_ufer' || key === 'rechtes_ufer' || key === 'cotes' || key === 'satelliten';
    }
    
    // ===== REGION_MAP als Plain-Object (ES5) =====
    var REGION_MAP = (function () {
        function setFrom(arr) {
            var o = {
            };
            for (var i = 0; i < arr.length; i++) o[arr[i]] = true; return o;
        }
        var left =[ 'medoc', 'haut medoc', 'saint estephe', 'pauillac', 'saint julien', 'moulis en medoc', 'listrac medoc', 'margaux', 'pessac leognan', 'graves'];
        var right =[ 'canon fronsac', 'fronsac', 'pomerol', 'lalande de pomerol', 'saint emilion', 'lussac saint emilion', 'montagne saint emilion', 'puisseguin saint emilion', 'saint georges saint emilion'];
        var cotes =[ 'blaye', 'blaye cotes de bordeaux', 'cotes de bourg', 'francs cotes de bordeaux', 'castillon cotes de bordeaux', 'cadillac cotes de bordeaux', 'premieres cotes de bordeaux', 'sainte foy bordeaux'];
        var sats =[ 'lussac saint emilion', 'montagne saint emilion', 'puisseguin saint emilion', 'saint georges saint emilion'];
        for (var i = 0; i < left.length; i++) left[i] = canon(left[i]);
        for (var j = 0; j < right.length; j++) right[j] = canon(right[j]);
        for (var k = 0; k < cotes.length; k++) cotes[k] = canon(cotes[k]);
        for (var t = 0; t < sats.length; t++) sats[t] = canon(sats[t]);
        return {
            linkes_ufer: setFrom(left),
            rechtes_ufer: setFrom(right),
            cotes: setFrom(cotes),
            satelliten: setFrom(sats)
        };
    })();
    // <— wichtig: sofort ausführen!
    
    // Einheitliche Mitgliedschaftsprüfung für REGION_MAP
    function inRegionSet(setLike, key) {
        if (! setLike) return false;
        if (typeof setLike === 'object' && ! Array.isArray(setLike)) return ! ! setLike[key]; // Plain-Object Map
        if (typeof setLike.has === 'function') return setLike.has(key);
        // echtes Set
        if (Array.isArray(setLike)) return setLike.indexOf(key) !== -1; // Array
        return false;
    }
    
    // ===== Zahlen/Sortier-Indizes =====
    var FORCE_NUMERIC_COLS = {
        0: true, 3: true
    };
    // Jahr, Bewertung
    function isNumericCol(c) {
        return (colTypes[c] === 'number') || ! ! FORCE_NUMERIC_COLS[c];
    }
    
    var numberColSep =[], numberVals =[], textIndex =[], textSortKey =[], trStart =[], trEnd =[], appCanon =[];
    
    function detectDecimalSeparator(cells) {
        var comma = 0, dot = 0;
        for (var i = 0; i < cells.length; i++) {
            var x = String(cells[i] || '');
            if (x.indexOf(',') >= 0) comma++;
            if (x.indexOf('.') >= 0) dot++;
        }
        return comma >= dot ? ',': '.';
    }
    function parseNumberWithSeparator(v, sep) {
        var s = String(v || '').trim().replace(/\s/g, '');
        if (sep === ',') {
            s = s.replace(/\./g, '').replace(/,/g, '.');
        } else {
            s = s.replace(/,/g, '');
        }
        var n = Number(s);
        return isFinite(n) ? n: NaN;
    }
    function parseDateDE(v) {
        var m = String(v || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
        if (! m) return new Date('invalid');
        var d = + m[1], mo = + m[2] -1, y = + m[3]; if (y < 100) y += (y >= 70 ? 1900: 2000);
        return new Date(y, mo, d);
    }
    
    function recomputeNumberSeps() {
        numberColSep =[];
        for (var c = 0; c < ths.length; c++) {
            numberColSep[c] = isNumericCol(c) ? detectDecimalSeparator(data.map(function (r) {
                return r.cells[c];
            })): null;
        }
    }
    function rebuildNumberVals() {
        numberVals =[];
        for (var c = 0; c < ths.length; c++) {
            numberVals[c] =[];
            if (isNumericCol(c)) {
                var sep = numberColSep[c] || '.';
                for (var r = 0; r < data.length; r++) {
                    var v = parseNumberWithSeparator(data[r].cells[c], sep);
                    numberVals[c][r] = isFinite(v) ? v: null;
                }
            } else {
                for (var r2 = 0; r2 < data.length; r2++) numberVals[c][r2] = null;
            }
        }
    }
    function rebuildTextIndex() {
        textIndex =[]; textSortKey =[];
        for (var c = 0; c < ths.length; c++) {
            textIndex[c] =[]; textSortKey[c] =[];
            for (var r = 0; r < data.length; r++) {
                var raw = data[r].cells[c];
                var vis = htmlCols[c] ? visibleText(raw): String(raw == null ? '': raw);
                textSortKey[c][r] = vis;
                textIndex[c][r] = normalize(vis);
            }
        }
    }
    
    function rebuildTrinkreifeVirtuals() {
        // ES5-kompatibel initialisieren (kein Array.prototype.fill)
        trStart = new Array(data.length);
        trEnd = new Array(data.length);
        for (var i = 0; i < data.length; i++) {
            trStart[i] = null;
            trEnd[i] = null;
        }
        
        // 1) Klassisch: "YYYY - YYYY"
        var reSpan = /(\d{4})\s*-\s*(\d{4})/;
        
        // 2) "bis YYYY"
        var reBis = /\bbis\s+(\d{4})\b/i;
        
        // 3) "ab YYYY"
        var reAb = /\bab\s+(\d{4})\b/i;
        
        for (var r = 0; r < data.length; r++) {
            var t = String(data[r].cells[4] || '');
            // Spalte 4 = "Trinkreife"
            
            var m1 = t.match(reSpan);
            if (m1) {
                trStart[r] = + m1[1];
                trEnd[r] = + m1[2];
                continue;
            }
            
            var m2 = t.match(reBis);
            if (m2) {
                trEnd[r] = + m2[1];
                // trStart bleibt null (unbekannt)
            }
            
            var m3 = t.match(reAb);
            if (m3) {
                trStart[r] = + m3[1];
                // trEnd bleibt null (unbekannt)
            }
        }
    }
    
    function rebuildAppCanon() {
        appCanon = new Array(data.length);
        for (var r = 0; r < data.length; r++) {
            appCanon[r] = canon(String(data[r].cells[2] || ''));
            // Spalte 2 = Appellation
        }
    }
    
    // ===== Château-Exact-Helfer =====
    function chateauCandidates(cellHtml) {
        var div = document.createElement('div');
        div.innerHTML = String(cellHtml || '');
        var seen = {
        };
        var out =[];
        var vis = visibleText(div.innerHTML);
        if (vis && ! seen[vis]) {
            seen[vis] = 1; out.push(vis);
        }
        var as = div.querySelectorAll('a[title]');
        for (var i = 0; i < as.length; i++) {
            var t = as[i].getAttribute('title');
            if (t && ! seen[t]) {
                seen[t] = 1; out.push(t);
            }
        }
        var txt = div.textContent ? div.textContent.trim(): '';
        if (txt && ! seen[txt]) {
            seen[txt] = 1; out.push(txt);
        }
        return out;
    }
    function chateauExactForms(name) {
        var forms = {
        };
        function add(v) {
            if (v) {
                forms[exactCanon(v)] = 1;
            }
        }
        var n = String(name || '').trim();
        add(n);
        add(n.replace(/\bCh\.\s*de\b/gi, 'Chateau de').replace(/\bCh\.\b/gi, 'Chateau'));
        add(n.replace(/\bCh\s*de\b/gi, 'Chateau de').replace(/\bCh\b/gi, 'Chateau'));
        var m1 = n.match(/^Ch(?:ateau)?\s+de\s+(.+)$/i);
        if (m1) {
            add(m1[1] + ' (Ch. de)');
            add(m1[1]);
        }
        var m2 = n.match(/^Ch(?:ateau)?\s+(.+)$/i);
        if (m2) {
            add(m2[1] + ' (Ch.)');
            add(m2[1]);
        }
        var out =[], k; for (k in forms) if (forms.hasOwnProperty(k)) out.push(k);
        return out;
    }
    
    // ===== Tokenizer (implizites UND) =====
    function tokenize(input) {
        var s = String(input || '');
        var tokens = [], re = /"([^"]+)"|(\()|(\))|(\|)|\b(ODER|OR|UND|AND|NOT)\b|([^"\s()|]+)/gi, m;
        while ((m = re.exec(s))) {
            if (m[1]) tokens.push({
                type: 'PHRASE', v: m[1], quoted: true
            }); else if (m[2]) tokens.push({
                type: 'LPAREN', v: '('
            }); else if (m[3]) tokens.push({
                type: 'RPAREN', v: ')'
            }); else if (m[4]) tokens.push({
                type: 'OR', v: '|'
            }); else if (m[5]) {
                var kw = m[5].toUpperCase();
                if (kw === 'ODER' || kw === 'OR') tokens.push({
                    type: 'OR', v: m[5]
                }); else if (kw === 'UND' || kw === 'AND') tokens.push({
                    type: 'AND', v: m[5]
                }); else if (kw === 'NOT') tokens.push({
                    type: 'NOT', v: 'NOT'
                });
            } else if (m[6]) {
                if (m[6].charAt(0) === '-' && m[6].length > 1) {
                    tokens.push({
                        type: 'NOT', v: 'NOT'
                    });
                    tokens.push({
                        type: 'WORD', v: m[6].slice(1)
                    });
                } else tokens.push({
                    type: 'WORD', v: m[6]
                });
            }
        }
        function beginsTerm(t) {
            return t && (t.type === 'WORD' || t.type === 'PHRASE' || t.type === 'LPAREN' || t.type === 'NOT');
        }
        function endsTerm(t) {
            return t && (t.type === 'WORD' || t.type === 'PHRASE' || t.type === 'RPAREN');
        }
        var out =[], i;
        for (i = 0; i < tokens.length; i++) {
            var cur = tokens[i], nxt = tokens[i + 1]; out.push(cur);
            if (cur && cur.type === 'RPAREN' && beginsTerm(nxt)) {
                if (!(nxt &&(nxt.type === 'OR' || nxt.type === 'AND'))) out.push({
                    type: 'AND', v: 'AND'
                });
                continue;
            }
            var curIsWordWithColon = cur && cur.type === 'WORD' && cur.v.indexOf(':') > 0;
            var nxtIsValueToken = nxt && (nxt.type === 'WORD' || nxt.type === 'PHRASE');
            var isSameFieldValueContinuation = curIsWordWithColon && nxtIsValueToken;
            if (endsTerm(cur) && beginsTerm(nxt)) {
                if (!(nxt &&(nxt.type === 'OR' || nxt.type === 'AND')) && ! isSameFieldValueContinuation) out.push({
                    type: 'AND', v: 'AND'
                });
            }
        }
        return out;
    }
    
    
    // ===== Parser (NOT > AND > OR) + SCOPE =====
    function parseQuery(tokens) {
        var i = 0;
        function peek() {
            return tokens[i];
        }
        function eat() {
            return tokens[i++];
        }
        
        function makeTerm(col, exprRaw, opts) {
            opts = opts || {
            };
            var expr = String(exprRaw || '').trim();
            var neg = false;
            if (expr.indexOf('-') === 0) {
                neg = true; expr = expr.slice(1).trim();
            } else if (/^not\b/i.test(expr)) {
                neg = true; expr = expr.replace(/^not\b/i, '').trim();
            }
            
            var isNumeric = false, op = null, num = null, virt = null, exactText = null, phraseText = null;
            
            // Phrase?
            if (opts.isPhrase) {
                phraseText = expr;
            }
            
            // Sonderfall: trinkreife:jetzt als virtuelles Feld
            if (col === V_TRINKBAR || (col === null && /^=\s*jetzt$/i.test(expr))) {
                virt = V_TRINKBAR;
                return {
                    col: null, neg: neg, words:[], isNumeric: false, op: null, num: null, virt: virt, exactText: null, phraseText: null
                };
            }
            
            // Exakt (=...)
            var mExact = expr.match(/^=\s*"?([^"]+?)"?\s*$/);
            if (mExact) {
                var val = mExact[1].trim();
                var looksNumber = /^[\d.,]+$/.test(val);
                if (looksNumber && ((col != null && col >= 0 && isNumericCol(col)) || col === V_TR_START || col === V_TR_ENDE)) {
                    isNumeric = true; op = '='; num = Number(String(val).replace(',', '.'));
                    virt =(col === V_TR_START || col === V_TR_ENDE) ? col: null;
                } else {
                    exactText = val;
                }
                return {
                    col: col, neg: neg, words:[], isNumeric: isNumeric, op: op, num: num, virt: virt, exactText: exactText, phraseText: phraseText
                };
            }
            
            var words = (! exactText && ! phraseText && expr.length) ? expr.split(/\s+/).filter(function (x) {
                return ! ! x;
            }):[];
            
            if (! exactText && ! phraseText) {
                if (words.length === 1) {
                    var m = words[0].match(/^(>=|<=|>|<|=)?\s*([\d.,]+)$/);
                    if (m) {
                        op = m[1] || '=';
                        num = Number(String(m[2]).replace(',', '.'));
                        if ((col != null && col >= 0 && isNumericCol(col)) || col === V_TR_START || col === V_TR_ENDE) {
                            isNumeric = isFinite(num);
                            virt = (col === V_TR_START || col === V_TR_ENDE) ? col: null;
                        }
                    }
                } else if (words.length === 0 && /^[\d.,]+$/.test(expr)) {
                    op = '='; num = Number(String(expr).replace(',', '.'));
                    if ((col != null && col >= 0 && isNumericCol(col)) || col === V_TR_START || col === V_TR_ENDE) {
                        isNumeric = isFinite(num);
                        virt = (col === V_TR_START || col === V_TR_ENDE) ? col: null;
                    }
                }
            }
            return {
                col: col, neg: neg, words: words, isNumeric: isNumeric, op: op, num: num, virt: virt, exactText: exactText, phraseText: phraseText
            };
        }
        
        function parsePrimary() {
            var t = peek();
            if (! t) return null;
            
            if (t.type === 'LPAREN') {
                eat();
                var expr = parseOr();
                if (peek() && peek().type === 'RPAREN') eat();
                return expr;
            }
            
            if (t.type === 'PHRASE') {
                eat();
                return {
                    kind: 'TERM', term: makeTerm(null, t.v, {
                        isPhrase: true
                    })
                };
            }
            
            if (t.type === 'WORD') {
                var raw = t.v;
                var colon = raw.indexOf(':');
                
                if (colon > 0) {
                    var leftSlug = exactCanon(raw.slice(0, colon)).replace(/\s+/g, '');
                    var rightRest = raw.slice(colon + 1);
                    
                    if (rightRest === '' && /:=$/.test(raw)) rightRest = '=';
                    
                    eat();
                    
                    if (rightRest === '' && peek() && (peek().type === 'LPAREN')) {
                        eat();
                        var inner = parseOr();
                        if (peek() && peek().type === 'RPAREN') eat();
                        
                        var colS = colSlugToIndex.hasOwnProperty(leftSlug) ? colSlugToIndex[leftSlug]: null;
                        return {
                            kind: 'SCOPE', col: colS, node: inner
                        };
                    }
                    
                    var parts =[], hasPhrase = false;
                    if (rightRest) parts.push(rightRest);
                    
                    while (peek()) {
                        var nt = peek().type;
                        if (nt === 'OR' || nt === 'AND' || nt === 'NOT' || nt === 'LPAREN' || nt === 'RPAREN') break;
                        if (nt === 'WORD' && peek().v.indexOf(':') > 0) break;
                        var nxt = eat();
                        if (nxt.type === 'PHRASE') {
                            hasPhrase = true; parts.push(nxt.v);
                        } else {
                            parts.push(nxt.v);
                        }
                    }
                    
                    var val = parts.join(' ').trim();
                    var colIdx = colSlugToIndex.hasOwnProperty(leftSlug) ? colSlugToIndex[leftSlug]: null;
                    
                    // Sonderfall: trinkreife:jetzt
                    if (leftSlug === 'trinkreife' && /^"?jetzt"?$/i.test(val)) {
                        return {
                            kind: 'TERM', term: makeTerm(V_TRINKBAR, '=jetzt')
                        };
                    }
                    
                    // Normales Feld: Wert übernehmen (Phrase-Flag durchreichen)
                    return {
                        kind: 'TERM', term: makeTerm(colIdx, val, {
                            isPhrase: hasPhrase
                        })
                    };
                }
                
                // Kein Doppelpunkt: Bare-Word
                eat();
                
                // Bare-Regionen (linkes_ufer | rechtes_ufer | cotes | satelliten)
                if (isRegionKey(raw)) {
                    return {
                        kind: 'TERM', term: makeTerm(V_REGION, raw)
                    };
                }
                
                // Sonst: globaler Text-Term
                return {
                    kind: 'TERM', term: makeTerm(null, raw)
                };
            }
            return null;
        }
        
        function parseUnary() {
            var neg = false; while (peek() && peek().type === 'NOT') {
                eat();
                neg = ! neg;
            }
            var node = parsePrimary();
            if (! node) return null;
            if (neg) node = {
                kind: 'NOT', node: node
            };
            return node;
        }
        function parseAnd() {
            var nodes =[], first = parseUnary();
            if (! first) return null; nodes.push(first);
            for (;;) {
                var t = peek();
                if (! t || t.type === 'OR' || t.type === 'RPAREN') break;
                if (t.type === 'AND') {
                    eat();
                    continue;
                }
                if (t.type === 'NOT' || t.type === 'LPAREN' || t.type === 'PHRASE' || t.type === 'WORD') {
                    var n = parseUnary();
                    if (n) nodes.push(n); else break;
                } else break;
            }
            return nodes.length === 1 ? nodes[0]: {
                kind: 'AND', nodes: nodes
            };
        }
        function parseOr() {
            var nodes =[], left = parseAnd();
            if (! left) return null; nodes.push(left);
            while (peek() && peek().type === 'OR') {
                eat();
                var right = parseAnd();
                if (right) nodes.push(right);
            }
            return nodes.length === 1 ? nodes[0]: {
                kind: 'OR', nodes: nodes
            };
        }
        return parseOr();
    }
    
    // ===== AND über OR verteilen (DNF) =====
    function dist(node) {
        if (! node) return node;
        switch (node.kind) {
            case 'AND': {
                var kids = (node.nodes ||[]).map(dist);
                var combos =[[]];
                for (var i = 0; i < kids.length; i++) {
                    var ch = kids[i];
                    if (ch && ch.kind === 'OR') {
                        var alts = (ch.nodes ||[]).map(dist);
                        var next =[], a, b;
                        for (a = 0; a < combos.length; a++) {
                            for (b = 0; b < alts.length; b++) {
                                next.push(combos[a].concat([alts[b]]));
                            }
                        }
                        combos = next;
                    } else {
                        for (var k = 0; k < combos.length; k++) combos[k].push(ch);
                    }
                }
                if (combos.length === 1) return {
                    kind: 'AND', nodes: combos[0]
                };
                return {
                    kind: 'OR', nodes: combos.map(function (nodes) {
                        return nodes.length === 1 ? nodes[0]: {
                            kind: 'AND', nodes: nodes
                        };
                    })
                };
            }
            case 'OR': return {
                kind: 'OR', nodes:(node.nodes ||[]).map(dist)
            };
            case 'NOT': return {
                kind: 'NOT', node: dist(node.node)
            };
            case 'SCOPE': return {
                kind: 'SCOPE', col: node.col, node: dist(node.node)
            };
            default: return node;
        }
    }
    
    // ===== Evaluierung =====
    function rowTextHasAllWords(cols, r, words) {
        for (var wi = 0; wi < words.length; wi++) {
            var needle = normalize(words[wi]);
            var hit = false;
            for (var ci = 0; ci < cols.length; ci++) {
                var c = cols[ci]; if (c < 0) continue;
                if (textIndex[c][r].indexOf(needle) >= 0) {
                    hit = true; break;
                }
            }
            if (! hit) return false;
        }
        return true;
    }
    function fieldTextForCol(c, r) {
        if (c === 1) return visibleText(data[r].cells[1]);
        if (c === 2) return String(data[r].cells[2] || '');
        return String(data[r].cells[c] || '');
    }
    
    function evalTerm(term, r, activeCols) {
        // ===== Numerik (inkl. virtuell trinkreife_*) =====
if (term.isNumeric) {

  // ⬇︎ NEU: Falls Trinkreife komplett leer, kein Treffer
  if ((term.virt === V_TR_START || term.virt === V_TR_ENDE) && trStart[r] == null && trEnd[r] == null) {
    return term.neg ? true : false;
  }

  if (!(term.col != null && (term.col >= 0 || term.virt === V_TR_START || term.virt === V_TR_ENDE))) {
    return term.neg ? true : false;
  }

  var v = null;
  if (term.col != null && term.col >= 0) v = numberVals[term.col][r];
  else if (term.virt === V_TR_START)     v = trStart[r];
  else if (term.virt === V_TR_ENDE)      v = trEnd[r];

  // ⬇︎ Anpassung: fehlende Trinkreifegrenze als unbeschränkt interpretieren
  if (v == null && (term.virt === V_TR_START || term.virt === V_TR_ENDE)) {
    var okNull = false;
    if (term.virt === V_TR_START) {
      okNull = (term.op === '<' || term.op === '<=');
    } else {
      okNull = (term.op === '>' || term.op === '>=');
    }
    return term.neg ? !okNull : okNull;
  }

  if (v == null) return term.neg ? true : false;

  var n = term.num;
  var ok = (term.op === '>')  ? (v >  n) :
           (term.op === '>=') ? (v >= n) :
           (term.op === '<')  ? (v <  n) :
           (term.op === '<=') ? (v <= n) :
                                (v === n);
  return term.neg ? !ok : ok;
}
        
        // REGION: erlaubt enthält UND exakt (via Canon + Map)
        if (term.col === V_REGION) {
            var valRaw = (term.words && term.words.length) ? term.words.join(' '): (term.exactText != null ? term.exactText: (term.phraseText || ''));
            
            var regionKey = canon(valRaw).replace(/\s+/g, '_');
            // "linkes ufer" → "linkes_ufer"
            var set = REGION_MAP[regionKey];
            var ok = ! ! set && inRegionSet(set, appCanon[r]);
            // appCanon[r] ist bereits canon() von Spalte 2
            
            return term.neg ? ! ok: ok;
        }
        
        // Appellation Spezialfall Bordeaux exakt
        if (term.col === 2) {
            if (term.words && term.words.length === 1 && canon(term.words[0]) === 'bordeaux') {
                var okB = (appCanon[r] === 'bordeaux');
                return term.neg ? ! okB: okB;
            }
        }
        
        // Exakter Text
        if (term.exactText != null) {
            if (term.col === 1) {
                // Château
                var needles = {
                },
                cf = chateauExactForms(term.exactText);
                for (var i1 = 0; i1 < cf.length; i1++) needles[cf[i1]] = 1;
                var cands = chateauCandidates(data[r].cells[1]);
                for (var j1 = 0; j1 < cands.length; j1++) {
                    var cand = cands[j1], candForms = chateauExactForms(cand), h = false, ii;
                    for (ii = 0; ii < candForms.length; ii++) if (needles[candForms[ii]]) {
                        h = true; break;
                    }
                    if (h) return term.neg ? false: true;
                    if (exactCanon(cand) === exactCanon(term.exactText)) return term.neg ? false: true;
                    // Wortbeutel
                    var wordsFn = function (s) {
                        return exactCanon(s).split(' ').filter(function (x) {
                            return ! ! x;
                        }).sort().join(' ');
                    };
                    if (wordsFn(cand) === wordsFn(term.exactText)) return term.neg ? false: true;
                }
                return term.neg ? true: false;
            }
            if (term.col === 2) {
                var okA = (exactCanon(appCanon[r]) === exactCanon(term.exactText));
                return term.neg ? ! okA: okA;
            }
            if (term.col != null && term.col >= 0) {
                var okC = (exactCanon(String(data[r].cells[term.col] || '')) === exactCanon(term.exactText));
                return term.neg ? ! okC: okC;
            }
            // global
            var cols = activeCols, any = false;
            for (var cc = 0; cc < cols.length; cc++) {
                var c = cols[cc], match = false;
                if (c === 1) {
                    var cands2 = chateauCandidates(data[r].cells[1]);
                    for (var k1 = 0; k1 < cands2.length; k1++) {
                        var cf2 = chateauExactForms(cands2[k1]);
                        var m2 = false, kk;
                        for (kk = 0; kk < cf2.length; kk++) if (exactCanon(cf2[kk]) === exactCanon(term.exactText)) {
                            m2 = true; break;
                        }
                        if (m2 || exactCanon(cands2[k1]) === exactCanon(term.exactText)) {
                            match = true; break;
                        }
                    }
                } else if (c === 2) {
                    match =(exactCanon(appCanon[r]) === exactCanon(term.exactText));
                } else {
                    match =(exactCanon(String(data[r].cells[c] || '')) === exactCanon(term.exactText));
                }
                if (match) {
                    any = true; break;
                }
            }
            return term.neg ? ! any: any;
        }
        
// „trinkreife:jetzt“
if (term.virt === V_TRINKBAR) {
  var year = new Date().getFullYear();
  var s = trStart[r], e = trEnd[r];

  // Mindestens eine Grenze muss vorhanden sein, sonst kein Treffer
  var hasAny = (s != null) || (e != null);

  var startOK = (s == null) ? (!TRINKBAR_STRIKT) : (s <= year);
  var endOK   = (e == null) ? (!TRINKBAR_STRIKT) : (e >= year);

  var okT = hasAny && startOK && endOK;
  return term.neg ? !okT : okT;
}
        
        // Phrasensuche (adjazent)
        if (term.phraseText != null) {
            var phraseNeedle = canonPhrase(term.phraseText);
            var cols2 = (term.col != null) ?[term.col]: activeCols;
            var okP = false;
            for (var pi = 0; pi < cols2.length; pi++) {
                var c2 = cols2[pi];
                var hay = (c2 === 2) ? String(data[r].cells[2] || ''): fieldTextForCol(c2, r);
                var can = canonPhrase(hay);
                if (can.indexOf(phraseNeedle) >= 0) {
                    okP = true; break;
                }
            }
            return term.neg ? ! okP: okP;
        }
        
        // Text enthält (Wort-UND)
        var cols3 = (term.col != null) ?[term.col]: activeCols;
        if (! term.words || term.words.length === 0) return term.neg ? true: false;
        var okW = rowTextHasAllWords(cols3, r, term.words);
        return term.neg ? ! okW: okW;
    }
    
    function evalNodeRow(node, activeCols, r) {
        if (! node) return true;
        switch (node.kind) {
            case 'TERM': return evalTerm(node.term, r, activeCols);
            case 'NOT': return ! evalNodeRow(node.node, activeCols, r);
            case 'SCOPE': {
                var scopedCols = (node.col != null) ?[node.col]: activeCols;
                return evalNodeRow(node.node, scopedCols, r);
            }
            case 'AND': {
                var kids = node.nodes ||[];
                for (var i = 0; i < kids.length; i++) if (! evalNodeRow(kids[i], activeCols, r)) return false;
                return true;
            }
            case 'OR': {
                var kids2 = node.nodes ||[];
                for (var j = 0; j < kids2.length; j++) if (evalNodeRow(kids2[j], activeCols, r)) return true;
                return false;
            }
            default: return true;
        }
    }
    
    // ===== Guards (Jahr/App/Region) – deaktiviert bei OR/NOT =====
    function extractHardGuards(qStr) {
        var guards = {
            years: null, appEq: null, appContainsAny: null, regionAny: null
        };
        
        // Jahre
        var yearRe = /jahr\s*:\s*(=|>=|<=|>|<)?\s*([0-9]{4})/gi, m, yearTerms =[];
        while ((m = yearRe.exec(qStr))) {
            var op =(m[1] || '=').trim(), y = parseInt(m[2], 10);
            if (! isNaN(y)) yearTerms.push({
                op: op, y: y
            });
        }
        if (yearTerms.length) {
            guards.years =[];
            for (var yi = 0; yi < yearTerms.length; yi++) {
                (function (term) {
                    guards.years.push(function (val) {
                        if (val == null) return false;
                        return term.op === '>' ? (val > term.y):
                        term.op === '>=' ? (val >= term.y):
                        term.op === '<' ? (val < term.y):
                        term.op === '<=' ? (val <= term.y): (val === term.y);
                    });
                })(yearTerms[yi]);
            }
        }
        
        // Appellation exakt
        var appEq = {
        };
        var appEqRegex = /appellation\s*:\s*=\s*(?:"([^"]+)"|([^\s()|]+))/gi;
        while ((m = appEqRegex.exec(qStr))) {
            var raw =(m[1] || m[2] || '').trim();
            if (raw) appEq[raw] = 1;
        }
        
        // Appellation enthält
        var appContRegex = /appellation\s*:\s*(?!\=)(?:"([^"]+)"|([^\s()|]+))/gi; var appPos =[];
        while ((m = appContRegex.exec(qStr))) {
            var raw2 =(m[1] || m[2] || '').trim();
            if (! raw2 || raw2.charAt(0) === '-') continue;
            appPos.push(raw2);
        }
        var promoted =[];
        for (var ai = 0; ai < appPos.length; ai++) {
            var v = appPos[ai];
            if (canon(v) === 'bordeaux') appEq[ 'Bordeaux'] = 1; else promoted.push(v);
        }
        var eqSet = null, k;
        for (k in appEq) if (appEq.hasOwnProperty(k)) {
            if (! eqSet) eqSet = {
            };
            eqSet[k] = 1;
        }
        if (eqSet) guards.appEq = eqSet;
        if (promoted.length) guards.appContainsAny = promoted;
        
        // Region
        var regRe = /region\s*:\s*(?:"([^"]+)"|([^\s()|]+))/gi; var regPos =[];
        while ((m = regRe.exec(qStr))) {
            var raw3 =(m[1] || m[2] || '').trim();
            if (! raw3 || raw3.charAt(0) === '-') continue;
            var key = canon(raw3).replace(/\s+/g, '_');
            regPos.push(key);
        }
        if (regPos.length) guards.regionAny = regPos;
        
        return guards;
    }
    
    function rowPassesGuards(r, guards) {
        // Jahre
        if (guards.years && guards.years.length) {
            var yr = numberVals[0][r];
            for (var i = 0; i < guards.years.length; i++) if (! guards.years[i](yr)) return false;
        }
        // Appellation exakt
        if (guards.appEq) {
            var cell = String(data[r].cells[2] || '');
            var canCell = canon(stripHTML(cell));
            var ok = false, k;
            for (k in guards.appEq) {
                if (guards.appEq.hasOwnProperty(k)) {
                    if (canCell === canon(k)) {
                        ok = true; break;
                    }
                }
            }
            if (! ok) return false;
        }
        // Appellation enthält
        if (guards.appContainsAny && guards.appContainsAny.length) {
            var cell2 = String(data[r].cells[2] || '');
            var can2 = canon(stripHTML(cell2)), any = false;
            for (var j = 0; j < guards.appContainsAny.length; j++) {
                if (can2.indexOf(canon(guards.appContainsAny[j])) >= 0) {
                    any = true; break;
                }
            }
            if (! any) return false;
        }
        // Region
        if (guards.regionAny && guards.regionAny.length){
    		var app = appCanon[r];
    		var anyR = false;
    		for (var ri=0; ri<guards.regionAny.length; ri++){
      			var set = REGION_MAP[guards.regionAny[ri]];
      			if (set && inRegionSet(set, app)) {
        			anyR = true;
        			break;
      			}
    	}
    if (!anyR) return false;
  }
        return true;
    }
    
    // ===== Pflicht-Constraints (numerisch) aus dem AST =====
    function numericKey(op, num) {
        return (op || '=') + '|' + String(num);
    }
    function numericPred(op, n) {
        return function (v) {
            if (v == null || isNaN(v)) return false;
            return op === '>' ? v > n: op === '>=' ? v >= n: op === '<' ? v < n: op === '<=' ? v <= n: v === n;
        };
    }
    function mandatoryNumeric(node, col) {
        if (! node) return[];
        switch (node.kind) {
            case 'TERM': {
                var t = node.term;
                if (t && t.isNumeric && (t.col === col || t.virt === col)) {
                    return[numericKey(t.op || '=', t.num)];
                }
                return[];
            }
            case 'SCOPE': return mandatoryNumeric(node.node, col);
            case 'NOT': return[];
            case 'AND': {
                var out =[], kids = node.nodes ||[];
                for (var i = 0; i < kids.length; i++) out = out.concat(mandatoryNumeric(kids[i], col));
                return out;
            }
            case 'OR': {
                var sets =[], kids2 = node.nodes ||[];
                for (var j = 0; j < kids2.length; j++) sets.push(objSet(mandatoryNumeric(kids2[j], col)));
                if (! sets.length) return[];
                var inter = sets[0], k;
                for (var s = 1; s < sets.length; s++) {
                    var kept = {
                    };
                    for (k in inter) if (inter.hasOwnProperty(k) && sets[s][k]) kept[k] = 1;
                    inter = kept;
                }
                return Object.keys(inter);
            }
            default: return[];
        }
    }
    function objSet(arr) {
        var o = {
        };
        for (var i = 0; i < arr.length; i++) o[arr[i]] = 1; return o;
    }
    function buildNumericPredicates(keys) {
        var preds =[];
        for (var i = 0; i < keys.length; i++) {
            var parts = keys[i].split('|'), op = parts[0], n = Number(parts[1]);
            if (isFinite(n)) preds.push(numericPred(op, n));
        }
        return preds;
    }
    
    // ===== Haupt-Filter =====
    function getActiveCols() {
        var a =[]; for (var i = 0; i < ths.length; i++) a.push(i);
        return a;
    }
    
    function applyFilter(qStr) {
        var q = (qStr == null ? '': String(qStr)).trim();
        var activeCols = getActiveCols();
        
        // === einfache Volltextsuche (ohne :, ohne () und ohne OR/AND/NOT) ===
        var looksSimple = (
        q.length > 0 && ! /[()]/.test(q) &&
        q.indexOf(':') === -1 && ! /[|]/.test(q) && ! /\b(?:und|and|oder|or|not)\b/i.test(q) && ! /"[^"]*"/.test(q) // <- NEU: wenn Phrasen in Anführungszeichen, dann NICHT simple
        );
        
        if (looksSimple) {
  var words = q.split(/\s+/).filter(function (x) { return !!x; });
  var pos = [], neg = [];
  for (var w = 0; w < words.length; w++) {
    var ww = words[w];
    if (ww.charAt(0) === '-' && ww.length > 1) neg.push(ww.slice(1));
    else pos.push(ww);
  }

  // ===== NEU A: Bare-Regionen aus pos/neg separieren =====
  //  - regionPos: z.B. ["linkes_ufer", "satelliten"]
  //  - regionNeg: z.B. ["rechtes_ufer"]
  //  - posText / negText: verbleibende "normale" Volltextwörter
  var regionPos = [], regionNeg = [], posText = [], negText = [];
  for (var i = 0; i < pos.length; i++) {
    var p = pos[i];
    if (isRegionKey(p)) regionPos.push(canon(String(p)).replace(/\s+/g, '_'));
    else posText.push(p);
  }
  for (var j = 0; j < neg.length; j++) {
    var n = neg[j];
    if (isRegionKey(n)) regionNeg.push(canon(String(n)).replace(/\s+/g, '_'));
    else negText.push(n);
  }
  // Ab hier weiter mit posText/negText statt pos/neg

  var hits = [];
  rows: for (var r = 0; r < data.length; r++) {

    // ===== NEU B: Bare-Regionen prüfen (vor Textprüfung) =====
    if (regionPos.length || regionNeg.length) {
      var app = appCanon[r];
      // Positive Regionen: mind. eine muss passen
      if (regionPos.length) {
        var okRegion = false;
        for (var ri = 0; ri < regionPos.length; ri++) {
          var setP = REGION_MAP[regionPos[ri]];
          if (setP && inRegionSet(setP, app)) { okRegion = true; break; }
        }
        if (!okRegion) continue rows;
      }
      // Negative Regionen: keine darf passen
      if (regionNeg.length) {
        var badRegion = false;
        for (var rj = 0; rj < regionNeg.length; rj++) {
          var setN = REGION_MAP[regionNeg[rj]];
          if (setN && inRegionSet(setN, app)) { badRegion = true; break; }
        }
        if (badRegion) continue rows;
      }
    }

    // --- POSITIVE Volltextwörter (nur noch posText) ---
    for (var p = 0; p < posText.length; p++) {
      var needle = normalize(posText[p]), ok = false;
      for (var c = 0; c < activeCols.length; c++) {
        if (textIndex[activeCols[c]][r].indexOf(needle) >= 0) { ok = true; break; }
      }
      if (!ok) continue rows;
    }

    // --- NEGATIVE Volltextwörter (nur noch negText) ---
    for (var n = 0; n < negText.length; n++) {
      var needleN = normalize(negText[n]), hit = false;
      for (var c2 = 0; c2 < activeCols.length; c2++) {
        if (textIndex[activeCols[c2]][r].indexOf(needleN) >= 0) { hit = true; break; }
      }
      if (hit) continue rows;
    }

    hits.push(r);
  }

  filtered = hits; currentPage = 1; renderPage();
  return;
}
    
    if (looksSimple) {
  var words = q.split(/\s+/).filter(function (x) { return !!x; });
  var pos = [], neg = [];
  for (var w = 0; w < words.length; w++) {
    var ww = words[w];
    if (ww.charAt(0) === '-' && ww.length > 1) neg.push(ww.slice(1));
    else pos.push(ww);
  }

  // ===== NEU A: Bare-Regionen aus pos/neg separieren =====
  //  - regionPos: z.B. ["linkes_ufer", "satelliten"]
  //  - regionNeg: z.B. ["rechtes_ufer"]
  //  - posText / negText: verbleibende "normale" Volltextwörter
  var regionPos = [], regionNeg = [], posText = [], negText = [];
  for (var i = 0; i < pos.length; i++) {
    var p = pos[i];
    if (isRegionKey(p)) regionPos.push(canon(String(p)).replace(/\s+/g, '_'));
    else posText.push(p);
  }
  for (var j = 0; j < neg.length; j++) {
    var n = neg[j];
    if (isRegionKey(n)) regionNeg.push(canon(String(n)).replace(/\s+/g, '_'));
    else negText.push(n);
  }
  // Ab hier weiter mit posText/negText statt pos/neg

  var hits = [];
  rows: for (var r = 0; r < data.length; r++) {

    // ===== NEU B: Bare-Regionen prüfen (vor Textprüfung) =====
    if (regionPos.length || regionNeg.length) {
      var app = appCanon[r];
      // Positive Regionen: mind. eine muss passen
      if (regionPos.length) {
        var okRegion = false;
        for (var ri = 0; ri < regionPos.length; ri++) {
          var setP = REGION_MAP[regionPos[ri]];
          if (setP && inRegionSet(setP, app)) { okRegion = true; break; }
        }
        if (!okRegion) continue rows;
      }
      // Negative Regionen: keine darf passen
      if (regionNeg.length) {
        var badRegion = false;
        for (var rj = 0; rj < regionNeg.length; rj++) {
          var setN = REGION_MAP[regionNeg[rj]];
          if (setN && inRegionSet(setN, app)) { badRegion = true; break; }
        }
        if (badRegion) continue rows;
      }
    }

    // --- POSITIVE Volltextwörter (nur noch posText) ---
    for (var p = 0; p < posText.length; p++) {
      var needle = normalize(posText[p]), ok = false;
      for (var c = 0; c < activeCols.length; c++) {
        if (textIndex[activeCols[c]][r].indexOf(needle) >= 0) { ok = true; break; }
      }
      if (!ok) continue rows;
    }

    // --- NEGATIVE Volltextwörter (nur noch negText) ---
    for (var n = 0; n < negText.length; n++) {
      var needleN = normalize(negText[n]), hit = false;
      for (var c2 = 0; c2 < activeCols.length; c2++) {
        if (textIndex[activeCols[c2]][r].indexOf(needleN) >= 0) { hit = true; break; }
      }
      if (hit) continue rows;
    }

    hits.push(r);
  }

  filtered = hits; currentPage = 1; renderPage();
  return;
}
 
        
        // === Voll-Parser → AST ===
        var tokens = tokenize(q);
        var ast = parseQuery(tokens);
        
        // === OR/NOT? Dann Guards deaktivieren ===
        var hasOrNot = /[|]|\b(?:oder|or|not)\b/i.test(q);
        var guards = hasOrNot ? {
            years: null, appEq: null, appContainsAny: null, regionAny: null
        }: extractHardGuards(q);
        
        // === AND über OR verteilen ===
        ast = dist(ast);
        
        // === AST evaluieren → Grundtreffer ===
        var hits =[];
        for (var rr = 0; rr < data.length; rr++) {
            if (evalNodeRow(ast, activeCols, rr)) hits.push(rr);
        }
        
        // === MUSS-Bedingungen (numerisch) immer nachziehen ===
        // Bewertung (3)
        var mustBew = mandatoryNumeric(ast, 3);
        if (mustBew && mustBew.length) {
            var bewPreds = buildNumericPredicates(mustBew);
            for (var i = hits.length -1; i >= 0; i--) {
                var r1 = hits[i], v1 = numberVals[3][r1], okAll = true, p1;
                for (p1 = 0; p1 < bewPreds.length; p1++) {
                    if (! bewPreds[p1](v1)) {
                        okAll = false; break;
                    }
                }
                if (! okAll) hits.splice(i, 1);
            }
        }
        // Jahr (0)
        var mustYear = mandatoryNumeric(ast, 0);
        if (mustYear && mustYear.length) {
            var yearPreds = buildNumericPredicates(mustYear);
            for (var j = hits.length -1; j >= 0; j--) {
                var r2 = hits[j], y2 = numberVals[0][r2], okAll2 = true, p2;
                for (p2 = 0; p2 < yearPreds.length; p2++) {
                    if (! yearPreds[p2](y2)) {
                        okAll2 = false; break;
                    }
                }
                if (! okAll2) hits.splice(j, 1);
            }
        }
        
        // === Guards (nur wenn aktiv) ===
        var finalHits;
        if ((guards.years && guards.years.length) ||
        (guards.appEq && Object.keys(guards.appEq).length) ||
        (guards.appContainsAny && guards.appContainsAny.length) ||
        (guards.regionAny && guards.regionAny.length)) {
            finalHits =[];
            for (var h = 0; h < hits.length; h++) {
                if (rowPassesGuards(hits[h], guards)) finalHits.push(hits[h]);
            }
        } else {
            finalHits = hits;
        }
        
        filtered = finalHits;
        currentPage = 1; renderPage();
    }
    window.applyFilter = applyFilter;
	
// ---- Minimal-Init für die pure Suchzeile (ohne Query-Builder/Chips) ----
(function initPlainSearch(){
  var si = document.getElementById('searchInput');
  if (!si) {
    console.warn('[plain-search] #searchInput nicht gefunden.');
    return;
  }

  // Sofort filtern beim Tippen
  si.addEventListener('input', function(e){
    var q = (e.target.value || '').trim();
    try { window.applyFilter(q); } catch(e) { console.error('applyFilter failed', e); }
  });

  // Optional: Enter = filtern + Fokus lassen
  si.addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      e.preventDefault();
      var q = (e.target.value || '').trim();
      try { window.applyFilter(q); } catch(e) { console.error('applyFilter failed', e); }
    }
  });

  // Beim Laden einmal initial filtern (z.B. leere Suche zeigt alles)
  try { window.applyFilter((si.value || '').trim()); } catch(e) {}
})();
    // ===== Sortierung / Paging / Render =====
    function clearAriaSort() {
        if (! thead) return;
        var s = thead.querySelectorAll('th.sortable');
        for (var i = 0; i < s.length; i++) s[i].setAttribute('aria-sort', 'none');
    }
    function sortBy(colIdx, type, dir) {
        dir = dir || 'asc';
        var collator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('de', {
            sensitivity: 'base'
        }): null;
        function cmpVal(aIdx, bIdx) {
            if (isNumericCol(colIdx)) {
                var na = numberVals[colIdx][aIdx], nb = numberVals[colIdx][bIdx];
                var va =(na == null ? - Infinity: na), vb =(nb == null ? - Infinity: nb);
                return va - vb;
            }
            if (type === 'date') {
                return + parseDateDE(data[aIdx].cells[colIdx]) - + parseDateDE(data[bIdx].cells[colIdx]);
            }
            var A = textSortKey[colIdx][aIdx], B = textSortKey[colIdx][bIdx];
            return collator ? collator.compare(A, B): (A < B ? -1:(A > B ? 1: 0));
        }
        filtered = filtered.map(function (idx, i) {
            return {
                idx: idx, i: i
            };
        }).sort(function (A, B) {
            var r = cmpVal(A.idx, B.idx);
            return r === 0 ? A.i - B.i:(dir === 'asc' ? r: - r);
        }).map(function (o) {
            return o.idx;
        });
        currentPage = 1; renderPage();
    }
    function onActivateSort(th) {
        var colIdx =[].indexOf.call(th.parentElement.children, th);
        var type = th.getAttribute('data-type') || 'string';
        var cur = th.getAttribute('aria-sort');
        var next = cur === 'ascending' ? 'descending': 'ascending';
        clearAriaSort();
        th.setAttribute('aria-sort', next);
        sortBy(colIdx, type, next === 'ascending' ? 'asc': 'desc');
    }
    if (thead) {
        thead.addEventListener('click', function (e) {
            var th = e.target.closest('th.sortable');
            if (th) onActivateSort(th);
        });
        thead.addEventListener('keydown', function (e) {
            var th = e.target.closest('th.sortable');
            if (! th) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivateSort(th);
            }
        });
    }
    
    function renderPage() {
        if (! tbody) return;
        var total = filtered.length, totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        tbody.innerHTML = '';
        if (total === 0) {
            if (noResultsCell) noResultsCell.classList.remove('hidden');
        } else {
            if (noResultsCell) noResultsCell.classList.add('hidden');
            var start =(currentPage -1) * pageSize, end = Math.min(start + pageSize, total);
            var frag = document.createDocumentFragment();
            for (var i = start; i < end; i++) {
                var idx = filtered[i]; var tr = document.createElement('tr');
                for (var c = 0; c < ths.length; c++) {
                    var td = document.createElement('td');
                    if (htmlCols[c]) td.innerHTML = data[idx].cells[c]; else td.textContent = data[idx].cells[c];
                    tr.appendChild(td);
                }
                frag.appendChild(tr);
            }
            tbody.appendChild(frag);
        }
        if (pageInfo) pageInfo.textContent = 'Seite ' + currentPage + '/' + Math.max(1, Math.ceil(total / pageSize));
        renderPageNumbers();
        updateResultLabel();
    }
    function updateResultLabel() {
        if (! resultInfo) return;
        var total = filtered.length;
        if (! searchInput || ! searchInput.value.trim()) {
            resultInfo.textContent = total + ' Châteaux/Weine gesamt';
        } else {
            var start =(currentPage -1) * pageSize + 1, end = Math.min(currentPage * pageSize, total);
            resultInfo.textContent = total + ' Treffer · Zeige ' + (total ? (start + '–' + end): '0');
        }
    }
    function renderPageNumbers() {
        if (! pageNumbers) return;
        var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        pageNumbers.innerHTML = ''; if (totalPages <= 1) return;
        function mkBtn(label, page, opts) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'pnum'; b.textContent = label; b.dataset.page = page;
            if (opts && opts.current) b.setAttribute('aria-current', 'page');
            b.addEventListener('click', function () {
                currentPage = page; renderPage();
            });
            return b;
        }
        function addEllipsis() {
            var s = document.createElement('span');
            s.className = 'ellipsis'; s.textContent = '…'; pageNumbers.appendChild(s);
        }
        var win = 2, first = 1, last = Math.max(1, Math.ceil(filtered.length / pageSize));
        var start = Math.max(first, currentPage - win), end = Math.min(last, currentPage + win);
        pageNumbers.appendChild(mkBtn(String(first), first, {
            current: currentPage === first
        }));
        if (start > first + 1) addEllipsis();
        for (var p = Math.max(start, first + 1);
        p <= Math.min(end, last -1);
        p++) {
            pageNumbers.appendChild(mkBtn(String(p), p, {
                current: currentPage === p
            }));
        }
        if (end < last -1) addEllipsis();
        if (last > first) pageNumbers.appendChild(mkBtn(String(last), last, {
            current: currentPage === last
        }));
    }
    if (pageSizeSel) {
        pageSizeSel.addEventListener('change', function () {
            pageSize = Number(pageSizeSel.value || 25);
            currentPage = 1; renderPage();
        });
    }
  
console.log('uniqChateau in script =', uniqChateau.length, uniqChateau.slice(0,5));
console.log('uniqAppellation in script =', uniqAppellation.length, uniqAppellation.slice(0,5));
  
// ===== Clear-Button / Input =====
  function toggleClear(){
    if (!clearBtn || !searchInput) return;
    clearBtn.style.visibility = searchInput.value.trim() ? 'visible' : 'hidden';
  }
  var deb = null;
  if (searchInput){
    searchInput.addEventListener('input', function(){
      toggleClear();
      if (deb) clearTimeout(deb);
      deb = setTimeout(function(){ applyFilter(searchInput.value); }, 50);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (!searchInput) return;
      searchInput.value = '';
      toggleClear();
      applyFilter('');
      searchInput.focus();
    });
    toggleClear();
  }

// ===== Autocomplete für chateau:, appellation:, region: =====
var suggDiv = document.createElement('div');
suggDiv.className = 'autocomplete-suggestions';
suggDiv.style.position = 'absolute';
suggDiv.style.zIndex = 9999;
suggDiv.style.display = 'none';
document.body.appendChild(suggDiv);

function positionSuggestionBox(){
  var rect = searchInput.getBoundingClientRect();
  suggDiv.style.left  = rect.left + 'px';
  suggDiv.style.top   = (rect.bottom + 2) + 'px';
  suggDiv.style.width = rect.width + 'px';
}

function showSuggestions(list, fieldPrefix){
  suggDiv.innerHTML = '';
  for (var i = 0; i < list.length; i++){
    var item = list[i];
    var div = document.createElement('div');
    div.className = 'autocomplete-item';
    div.textContent = item;
    (function(val, prefix){
    div.addEventListener('mousedown', function(ev){
  if (deb) {
    clearTimeout(deb);
    deb = null;
  }
  var q = searchInput.value;
  var idx = q.lastIndexOf(prefix);
  var before = q.slice(0, idx + prefix.length);
  // Exakt-Suche setzen
  searchInput.value = before + '="' + val + '"';
  suggDiv.style.display = 'none';
  applyFilter(searchInput.value);

  // Neu: Chips neu rendern, falls Funktion definiert
  if (typeof window.renderScopeChips === 'function') {
    window.renderScopeChips();
  }

  searchInput.focus();
});
      
    })(item, fieldPrefix);
    suggDiv.appendChild(div);
  }
  positionSuggestionBox();
  suggDiv.style.display = 'block';
} 

searchInput.addEventListener('input', function(){
  var q = searchInput.value;
  var m;
  if (m = q.match(/(?:^|\s)(chateau:)([^\s]*)$/i)) {
    var part = m[2].toLowerCase();
    var candidates = uniqChateau.filter(function(c){
      return normalize(c).indexOf(part) >= 0;
    });
    showSuggestions(candidates, m[1]);
  }
  else if (m = q.match(/(?:^|\s)(appellation:)([^\s]*)$/i)) {
    var part = m[2].toLowerCase();
    var candidates = uniqAppellation.filter(function(a){
      return normalize(a).indexOf(part) >= 0;
    });
    showSuggestions(candidates, m[1]);
  }
  else if (m = q.match(/(?:^|\s)(region:)([^\s]*)$/i)) {
    var part = m[2].toLowerCase();
    var candidates = ['linkes_ufer','rechtes_ufer','cotes','satelliten'].filter(function(r){
      return r.indexOf(part) >= 0;
    });
    showSuggestions(candidates, m[1]);
  }
  else {
    suggDiv.style.display = 'none';
  }
});

  // ===== Indizes neu aufbauen + Filter anwenden =====
  function rebuildIndexesAndApply(){
  recomputeNumberSeps();
  rebuildTextIndex();
  rebuildNumberVals();
  rebuildTrinkreifeVirtuals();
  rebuildAppCanon();

  // Autocomplete-Listen aktualisieren
  uniqChateau = Array.from(new Set(data.map(function(r){
  return visibleText(r.cells[1] || '');
}))).filter(function(s){
  return s && s.length > 1;
}).sort();
  uniqAppellation = Array.from(new Set(data.map(function(r){
    return String(r.cells[2]||'');
  }))).sort();

  applyFilter(searchInput ? String(searchInput.value || '') : '');
}

  // ===== Öffentliche API zum Nachladen von Zeilen =====
  window.addRows = function(rows){
    if (!Array.isArray(rows) || !rows.length) return;
    var startId = data.length;
    for (var i = 0; i < rows.length; i++){
      var cells = rows[i];
      if (!Array.isArray(cells) || cells.length !== ths.length) continue;
      data.push({ id: startId + i, cells: cells });
    }
    rebuildIndexesAndApply();
  };
  window.getDistinctValues = function(field){
    var collator = (typeof Intl!=='undefined' && Intl.Collator) ? new Intl.Collator('de',{sensitivity:'base'}) : null;
    function sortArr(a){ return a.sort(function(x,y){
      return collator? collator.compare(x,y) : (x<y?-1:(x>y?1:0));
    }); }
    if (field==='chateau'){
      var set={}, out=[];
      for (var r=0; r<data.length; r++){
        var v = visibleText(data[r].cells[1]);
        if (!set[v]){ set[v]=1; out.push(v); }
      }
      return sortArr(out);
    }
    if (field==='appellation'){
      var set2={}, out2=[];
      for (var r2=0; r2<data.length; r2++){
        var v2 = String(data[r2].cells[2]||'');
        if (!set2[v2]){ set2[v2]=1; out2.push(v2); }
      }
      return sortArr(out2);
    }
    if (field==='region'){
      return ['linkes_ufer','rechtes_ufer','cotes','satelliten'];
    }
    return [];
  };

  // ===== Initial =====
  renderPage();
})();
