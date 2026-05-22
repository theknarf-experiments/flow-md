" plugin/flowmd.vim — flow-md inline query viewer.
"
" Renders the results of ```datalog-query blocks inline (as virtual-text
" markdown tables) for markdown buffers, by querying a running `flow-md serve`.
" Display-only: the buffer is never modified.
"
" Config:
"   g:flowmd_server       host:port of the server (default 'localhost:4747')
"   g:flowmd_enabled      set to 0 to disable auto-refresh
"   g:flowmd_smoothscroll set to 0 to disable 'smoothscroll' (default 1). On is
"                         smoother, but Vim renders stacked virtual text with an
"                         occasional horizontal shift at some scroll offsets;
"                         set 0 if you'd rather scroll a block-height at a time.
"   g:flowmd_loaded       guard; set to skip loading
"
" The server resolves buffer paths against its own vault root, so Vim can be
" launched from any directory.
"
" Commands:  :FlowmdRefresh   :FlowmdClear
" Highlight: flowmdTable (defaults to Comment)

if exists('g:flowmd_loaded') || &compatible
  finish
endif
let g:flowmd_loaded = 1

if v:version < 900 || !has('textprop') || !exists('*ch_open')
  echohl WarningMsg
  echomsg 'flow-md: needs Vim 9.0+ with +textprop and +channel; disabled'
  echohl None
  finish
endif

highlight default link flowmdTable Comment

command! FlowmdRefresh call flowmd#refresh()
command! FlowmdClear   call flowmd#clear()

function! s:schedule(bufnr, delay) abort
  if !get(g:, 'flowmd_enabled', 1)
    return
  endif
  call timer_start(a:delay, {-> flowmd#refresh_buf(a:bufnr)})
endfunction

augroup flowmd
  autocmd!
  " On open: the server already knows the file from its initial scan.
  autocmd BufReadPost *.md,*.markdown call s:schedule(expand('<abuf>') + 0, 50)
  " On save: give the watcher a beat to re-evaluate, then refresh.
  autocmd BufWritePost *.md,*.markdown call s:schedule(expand('<abuf>') + 0, 250)
augroup END
