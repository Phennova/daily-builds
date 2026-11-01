// Greenlist - the five nights. Template syntax: {first choice|second|third~}; '~' = extra awkward, '=N' = explicit awkwardness.
(function (root) {
  'use strict';
  const NIGHTS = [
    {
      id: 1, title: 'First Dispatch', mode: 'scrub', key: 'scribe-91c4', k: 1, gamma: 0.25, delta: 4.0,
      band: [4.2, 5.8], seed: 101, passZ: 2.0, maxChanged: 7, maxAwk: 15, show: 'colours', preview: true, scans: 0,
      brief: 'The key leaked from a Ministry laptop, so tonight you can SEE the green list. Every green word is evidence. ' +
        'Swap words until the detector score drops below 2.0. Watch out: a word\'s colour depends on the word before it, ' +
        'so each swap also re-rolls its neighbour.',
      text: "{Friends|Comrades|Neighbours|Listen}, the {checkpoint|barrier|roadblock|gate~} on {Canal Street|the canal " +
        "road|Canal Row~} {closes|shuts|locks|seals~} {at nine|at nightfall|early|at 21:00~} {tonight|this " +
        "evening|today}. {Do not|Don't|Never|Please don't} {carry|bring|take|move} {paper|printed|written~} " +
        "{copies|pages|sheets|prints} {past|across|over|beyond} the {bridge|crossing|river|span~}. {The|Their|Those} " +
        "{scanners|readers|detectors|machines} {now|currently|these days|already} {flag|catch|mark|spot} " +
        "{anything|everything|every page|all text~} {SCRIBE|the machine|it|our model~} {wrote|produced|drafted|made~}. " +
        "{Meet|Gather|Wait|Assemble~} {at|by|behind|near} the {bakery|bread shop|old mill|baker's} " +
        "{instead|tomorrow|after dark|at dawn}. {Burn|Destroy|Shred|Eat~} this {note|message|page|letter} " +
        "{once|after|when|as soon as} you {have read|read|finish~|memorise} it."
    },
    {
      id: 2, title: 'The Printer', mode: 'scrub', key: 'scribe-91c4', k: 1, gamma: 0.25, delta: 4.0,
      band: [4.2, 5.8], seed: 202, passZ: 2.0, maxChanged: 9, maxAwk: 17, show: 'colours', preview: false, scans: 0,
      brief: 'Same key, but no more hints: you only see colours after you commit a swap. The Ministry\'s perplexity filter ' +
        'is stricter tonight - clumsy synonyms will get the page flagged as "unnatural".',
      text: "{The|Our|That|One} {printer|press|workshop|print shop} on {Hollis|Mill|Canal} {Lane|Street|Row} {was|got} " +
        "{raided|searched|stormed|hit} {last|on Friday|before|late} {night|evening|dawn~}. " +
        "{Agents|Officers|Inspectors|Men} {from|of|sent by} the Ministry {seized|took|confiscated|removed} " +
        "{three|several|both|all three~} {machines|presses|devices|printers} and {every|each|any|all~} " +
        "{box|crate|carton|ream} of {paper|stock|newsprint|ink}. {Old|Elderly|Poor|Aged~} {Marta|Teodor|Ilse} was " +
        "{taken|detained|arrested|held} for {questioning|hours|interview~}. {We|Many|Some|Friends~} " +
        "{believe|think|suspect|fear} {someone|somebody|a neighbour|a friend} {inside|within|close} " +
        "{gave|handed|passed|sold} {them|the Ministry} the {address|location|place|street}. {Until|Before|Till~} we " +
        "{know|learn|discover|find out} who, {trust|believe|tell|rely on} {nobody|no one|no person~} " +
        "{outside|beyond|past} your {own|small|immediate~} {cell|circle|group|house}."
    },
    {
      id: 3, title: 'Two Words Back', mode: 'scrub', key: 'prov-2x91', k: 2, gamma: 0.25, delta: 4.0,
      band: [4.2, 5.8], seed: 303, passZ: 2.0, maxChanged: 9, maxAwk: 26, show: 'colours', preview: false, scans: 0,
      brief: 'The Ministry upgraded SCRIBE: the green list is now seeded by the previous TWO words. One swap can re-colour ' +
        'up to three words. New key, but our contact leaked it again.',
      text: "{Tomorrow|On Tuesday|At noon|Soon} the Ministry {will|plans to|intends to|is set to} " +
        "{announce|unveil|reveal|publish} a {new|fresh|strict|novel~} {rule|law|decree|order}: {every|each|any} " +
        "{letter|message|note|parcel} {sent|posted|mailed|going} {abroad|overseas|out|across the border} " +
        "{must|shall|has to|will} {carry|bear|include|show} a {certificate|seal|stamp|mark} of " +
        "{human|personal|true|human hand~} {origin|authorship|provenance|making}. {Without|Lacking|Absent~} it, the " +
        "{post office|mail|post|censor} {will|is going to|shall} {hold|keep|open|detain~} the " +
        "{letter|envelope|message|package} and {report|name|flag|find} the {sender|writer|author|household}. " +
        "{This|That|Such a rule~} {ends|kills|finishes|closes} our {last|final|only|best} {safe|secure|quiet|open} " +
        "{channel|route|line|road} to the {coast|harbour|south|border}. We {need|require|want|must have~} " +
        "{forgers|engravers|printers|stamp makers} and we {need|want|require|must find} them {soon|quickly|now|before " +
        "winter}."
    },
    {
      id: 4, title: 'Blind', mode: 'scrub', key: 'prov-c0ld', k: 1, gamma: 0.25, delta: 4.0,
      band: [4.2, 5.8], seed: 404, passZ: 2.0, maxChanged: 9, maxAwk: 18, show: 'scan', preview: false, scans: 6,
      brief: 'The key rotated at midnight and nobody has the new one. You can no longer see colours. You have a stolen ' +
        'scanner with a few charges: each scan shows the detector score and how many words in each sentence are green.',
      text: "{Listen|Look|Read|Attention~} {carefully|closely|well|now}. The {key|cipher|secret|code} " +
        "{changed|rotated|reset|moved~} at {midnight|twelve|dusk|0000~}, so {our|the|all} {old|earlier|previous|stolen} " +
        "{tables|charts|lists|notes} are {useless|worthless|dead|void}. {Each|Every|Any|One} {draft|text|page|letter} " +
        "{now|from now on|today|here} {needs|requires|must get~|deserves} {testing|checking|scanning|a test} " +
        "{before|ahead of|prior to~} {release|printing|sending|use}. {We|Our team|Friends|The cell~} " +
        "{stole|took|lifted|borrowed} {one|a single|a lone~|an old} {scanner|reader|detector|unit} from the " +
        "{depot|warehouse|yard|station}, but its {battery|cell|charge|power} is {almost|nearly|close to|very} " +
        "{flat|empty|gone|low}. {Use|Spend|Waste~|Take} {each|every|any|your} {scan|reading|test|charge} " +
        "{wisely|carefully|sparingly|well}. {Change|Alter|Swap|Edit} {words|phrases|wording|text} in " +
        "{small|short|tiny|few} {steps|batches|runs|moves} and {watch|track|note|see} {which|what} " +
        "{lines|sentences|parts|rows} {move|shift|change|drop}."
    },
    {
      id: 5, title: 'Frame the Minister', mode: 'spoof', key: 'prov-2x91', k: 2, gamma: 0.25, delta: 0,
      band: [-1.2, 0.8], seed: 505, passZ: 4.0, maxChanged: 10, maxAwk: 15, show: 'colours', preview: false, scans: 0,
      brief: 'Reverse it. The Minister wrote tonight\'s broadcast BY HAND, and the key from night 3 is still live. Edit his ' +
        'speech before it airs so that the Ministry\'s own detector stamps it MACHINE: push the score to 4.0 or more.',
      text: "{Citizens|Friends|People|Workers} of the {republic|nation|city|homeland}. {Tonight|This evening|Today|Now} I " +
        "{speak|talk|come|appeal~} {to you|plainly|directly|openly} {about|on|regarding~|of} " +
        "{trust|truth|honesty|faith}. {Machines|Algorithms|Computers|Engines~} {write|produce|spread|churn out} " +
        "{lies|falsehoods|fictions|rumours} {faster|quicker|sooner|more quickly~} than {any|a single|one|a} " +
        "{person|human|citizen|man} {could|can|ever could~|might}. {That|This|And that} is {why|the reason} the " +
        "Ministry {certifies|checks|stamps|reads} {every|each|all~|your} {word|line|sentence|page}. I " +
        "{wrote|composed|penned|made~} {these words|this speech|my remarks|every line~} {by " +
        "hand|myself|personally|alone}, as {every|each|any|a} {honest|loyal|decent|good} " +
        "{citizen|person|worker|patriot} {should|must|ought to|will}. {Trust|Believe|Follow|Honour} the " +
        "{seal|stamp|certificate|mark}, and {you|we|all of us|none of you} will {never|not ever~|seldom=2|not} be " +
        "{deceived|fooled|misled|lied to}."
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = NIGHTS;
  else root.NIGHTS = NIGHTS;
})(typeof window !== 'undefined' ? window : globalThis);
