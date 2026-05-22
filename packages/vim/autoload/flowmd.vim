" autoload/flowmd.vim — core logic for the flow-md inline query viewer.
"
" Talks to `flow-md serve` over Vim's channel API with a raw HTTP/1.0 request
" (no curl, no external process), then renders each query's result as a
" markdown table using text-property virtual text below the query block's
" closing fence. Nothing in the buffer is ever modified.
"
" Requires Vim 9.0.0067+ (virtual text via prop_add text_align).

let s:proptype = 'flowmd_table'

function! flowmd#init() abort
  if !exists('*prop_type_add')
    return 0
  endif
  if empty(prop_type_get(s:proptype))
    call prop_type_add(s:proptype, {'highlight': 'flowmdTable'})
  endif
  return 1
endfunction

" --- HTTP over a raw channel ------------------------------------------------

" Synchronous GET against the configured server. Returns the decoded JSON
" value, or v:null on any failure (server down, timeout, bad response).
function! flowmd#request(reqpath) abort
  let l:addr = get(g:, 'flowmd_server', 'localhost:4747')
  try
    let l:ch = ch_open(l:addr, {'mode': 'raw', 'waittime': 300})
  catch
    return v:null
  endtry
  if ch_status(l:ch) !=# 'open'
    return v:null
  endif
  call ch_sendraw(l:ch,
        \ 'GET ' . a:reqpath . " HTTP/1.0\r\n" .
        \ "Host: localhost\r\n" .
        \ "Connection: close\r\n\r\n")
  let l:resp = ''
  while 1
    let l:chunk = ch_readraw(l:ch, {'timeout': 300})
    if l:chunk ==# ''
      break
    endif
    let l:resp .= l:chunk
  endwhile
  try
    call ch_close(l:ch)
  catch
  endtry
  return s:parse_http(l:resp)
endfunction

function! s:parse_http(resp) abort
  let l:idx = stridx(a:resp, "\r\n\r\n")
  if l:idx < 0
    return v:null
  endif
  let l:body = strpart(a:resp, l:idx + 4)
  try
    return json_decode(l:body)
  catch
    return v:null
  endtry
endfunction

" --- url helpers ------------------------------------------------------------

" The buffer's absolute path. The server resolves it against the vault root,
" so Vim can be started from anywhere — no working-directory assumptions.
function! s:abspath(bufnr) abort
  return fnamemodify(bufname(a:bufnr), ':p')
endfunction

function! s:urlencode(s) abort
  let l:out = substitute(a:s, '%', '%25', 'g')
  let l:out = substitute(l:out, ' ', '%20', 'g')
  let l:out = substitute(l:out, '#', '%23', 'g')
  let l:out = substitute(l:out, '?', '%3F', 'g')
  let l:out = substitute(l:out, '&', '%26', 'g')
  return l:out
endfunction

" --- rendering --------------------------------------------------------------

function! flowmd#refresh() abort
  call flowmd#refresh_buf(bufnr('%'))
endfunction

function! flowmd#refresh_buf(bufnr) abort
  if !flowmd#init()
    return
  endif
  if !bufexists(a:bufnr) || empty(bufname(a:bufnr))
    return
  endif
  let l:abs = s:abspath(a:bufnr)
  let l:resp = flowmd#request('/queries?abspath=' . s:urlencode(l:abs))
  if type(l:resp) != v:t_dict || !has_key(l:resp, 'queries')
    return
  endif
  call s:clear(a:bufnr)
  for l:q in l:resp.queries
    call s:render_one(a:bufnr, l:q)
  endfor
  if !empty(l:resp.queries)
    call s:smoothscroll(a:bufnr)
  endif
endfunction

" Tables are virtual text "below" a line, so a query block is taller than one
" screen row. Three Vim settings make scrolling through them behave:
"   - 'smoothscroll' (window-local): scroll a screen row at a time instead of a
"     whole buffer line, so tall blocks don't jump past in one step.
"   - 'display' must include "lastline" (global): otherwise a tall line that
"     only partly fits is replaced by '@' filler lines instead of being shown
"     truncated. Without it, smoothscroll surfaces the '@' fill constantly.
"   - 'showbreak' = NONE (window-local): when smoothscroll partly scrolls a
"     tall line, Vim prefixes the top row with 'showbreak' + indent as if it
"     were a wrapped continuation, shoving the table right. The special value
"     NONE overrides the global marker with "none" per-window (a plain empty
"     value would instead inherit the global setting).
function! s:smoothscroll(bufnr) abort
  if !get(g:, 'flowmd_smoothscroll', 1) || !exists('+smoothscroll')
    return
  endif
  if &display !~# 'lastline'
    set display+=lastline
  endif
  for l:win in win_findbuf(a:bufnr)
    call win_execute(l:win, 'setlocal smoothscroll showbreak=NONE')
  endfor
endfunction

function! s:render_one(bufnr, q) abort
  let l:fence = s:find_close_fence(a:bufnr, a:q.line)
  if l:fence <= 0
    return
  endif
  for l:line in s:table_lines(a:q)
    call prop_add(l:fence, 0, {
          \ 'bufnr': a:bufnr,
          \ 'type': s:proptype,
          \ 'text': l:line,
          \ 'text_align': 'below',
          \ 'text_padding_left': 0,
          \ })
  endfor
endfunction

" Find the ``` line that closes the query block opened at a:open.
function! s:find_close_fence(bufnr, open) abort
  let l:lines = getbufline(a:bufnr, a:open + 1, '$')
  let l:i = 0
  for l:ln in l:lines
    if l:ln =~# '^\s*```'
      return a:open + 1 + l:i
    endif
    let l:i += 1
  endfor
  return 0
endfunction

function! s:cell(v) abort
  return type(a:v) == v:t_string ? a:v : string(a:v)
endfunction

function! s:pad(s, w) abort
  return a:s . repeat(' ', a:w - strdisplaywidth(a:s))
endfunction

" Build the lines of a markdown table (header, separator, rows, count).
function! s:table_lines(q) abort
  let l:cols = a:q.columns
  " Result row order isn't guaranteed by the engine; sort for stable display.
  let l:rows = sort(copy(a:q.rows),
        \ {a, b -> string(a) ==# string(b) ? 0 : (string(a) ># string(b) ? 1 : -1)})
  let l:n = len(l:cols)

  let l:widths = map(copy(l:cols), 'strdisplaywidth(v:val)')
  for l:row in l:rows
    let l:i = 0
    while l:i < l:n
      let l:cw = strdisplaywidth(s:cell(get(l:row, l:i, '')))
      let l:widths[l:i] = max([l:widths[l:i], l:cw])
      let l:i += 1
    endwhile
  endfor

  let l:out = []
  call add(l:out, s:row_line(l:cols, l:widths))
  call add(l:out, s:sep_line(l:widths))
  if empty(l:rows)
    call add(l:out, '(no results)')
  else
    for l:row in l:rows
      let l:cells = []
      let l:i = 0
      while l:i < l:n
        call add(l:cells, s:cell(get(l:row, l:i, '')))
        let l:i += 1
      endwhile
      call add(l:out, s:row_line(l:cells, l:widths))
    endfor
    call add(l:out, len(l:rows) . (len(l:rows) == 1 ? ' row' : ' rows'))
  endif
  return l:out
endfunction

function! s:row_line(cells, widths) abort
  let l:parts = []
  let l:i = 0
  while l:i < len(a:widths)
    call add(l:parts, s:pad(s:cell(get(a:cells, l:i, '')), a:widths[l:i]))
    let l:i += 1
  endwhile
  return '| ' . join(l:parts, ' | ') . ' |'
endfunction

function! s:sep_line(widths) abort
  let l:parts = []
  for l:w in a:widths
    call add(l:parts, repeat('-', max([3, l:w])))
  endfor
  return '| ' . join(l:parts, ' | ') . ' |'
endfunction

" --- clearing ---------------------------------------------------------------

function! s:clear(bufnr) abort
  if empty(prop_type_get(s:proptype))
    return
  endif
  let l:last = max([1, len(getbufline(a:bufnr, 1, '$'))])
  call prop_remove({'type': s:proptype, 'bufnr': a:bufnr, 'all': v:true},
        \ 1, l:last)
endfunction

function! flowmd#clear() abort
  call s:clear(bufnr('%'))
endfunction
