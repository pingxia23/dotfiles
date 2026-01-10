" Enable line numbers
set number

" Enable relative line numbers
set relativenumber

" Enable syntax highlighting
syntax on

" Enable file type detection and plugins
filetype plugin indent on

" Set color scheme (you can change this to your preferred color scheme)
colorscheme desert

" Enable 256 color support
set t_Co=256

" Enable scrollable mouse support
set mouse=a

" Set the tab width to 4 spaces
set tabstop=4
set shiftwidth=4
set expandtab

" Show matching parentheses
set showmatch

" Highlight the current line
set cursorline

" Enable incremental search
set incsearch

" Enable search highlighting
set hlsearch

" Ignore case while searching
set ignorecase

" Override ignorecase if search pattern contains uppercase letters
set smartcase

" Enable line wrapping
set wrap

" Show command in the bottom bar
set showcmd

" Show partial command in the last line of the screen
set showmode

" Display the cursor position
set ruler

" Enable persistent undo so that undo history persists across sessions
set undofile

" Set a directory for undo files
set undodir=~/.vim/undodir

" Enable auto-completion for commands
set wildmenu

" Show the current file name in the window title
set title

" Better display for messages
set cmdheight=2

" Set split window preferences
set splitbelow
set splitright

" Automatically read files changed outside of Vim
set autoread

" Show hidden characters
set list
set listchars=tab:»·,trail:·,extends:>,precedes:<

" Disable backup and swap files
set nobackup
set nowritebackup
set noswapfile

" Enable clipboard interaction (for systems with clipboard support)
set clipboard=unnamedplus

" Set encoding
set encoding=utf-8

" Set the default text width for wrapping
set textwidth=80

" Custom key bindings (examples)
" Map Ctrl + N to toggle line numbers
nnoremap <C-n> :set number!<CR>

" Map Ctrl + T to open a new tab
nnoremap <C-t> :tabnew<CR>

" Map Ctrl + W to close the current tab
nnoremap <C-w> :tabclose<CR>

" Map Ctrl + Arrow keys to switch between windows
nnoremap <C-Left> :wincmd h<CR>
nnoremap <C-Down> :wincmd j<CR>
nnoremap <C-Up> :wincmd k<CR>
nnoremap <C-Right> :wincmd l<CR>

" Plugin manager (using vim-plug as an example)
call plug#begin('~/.vim/plugged')

" List your plugins here
Plug 'tpope/vim-sensible'
Plug 'scrooloose/nerdtree'
Plug 'junegunn/fzf'
Plug 'junegunn/fzf.vim'
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'preservim/nerdcommenter'
Plug 'sheerun/vim-polyglot'

call plug#end()

" NERDTree settings
map <C-n> :NERDTreeToggle<CR>

" FZF settings
nnoremap <silent> <C-p> :Files<CR>

" Airline settings
let g:airline#extensions#tabline#enabled = 1
