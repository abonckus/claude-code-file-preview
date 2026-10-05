-- Tree-sitter highlighting through Neovim, for md-preview's code blocks.
-- usage: nvim --headless --clean -l highlight.lua <lang>   (source on stdin)
-- prints a JSON array of [text, capture | null] spans, or null when the
-- language has no parser or highlights query installed.
vim.opt.rtp:append(vim.fn.stdpath('data') .. '/site') -- where nvim-treesitter installs parsers and queries

local lang = arg[1]
local src = io.read('a')
local ok, parser = pcall(vim.treesitter.get_string_parser, src, lang)
local query = ok and vim.treesitter.query.get(lang, 'highlights')
if not query then
  io.write('null')
  return
end

-- byte -> capture; later captures are more specific and win
local cap = {}
for id, node in query:iter_captures(parser:parse()[1]:root(), src, 0, -1) do
  local name = query.captures[id]
  if name:sub(1, 1) ~= '_' and name ~= 'spell' and name ~= 'nospell' and name ~= 'error' then
    local _, _, s = node:start()
    local _, _, e = node:end_()
    for b = s + 1, e do cap[b] = name end
  end
end

local spans, cur, buf = {}, false, {}
local function push()
  if #buf > 0 then spans[#spans + 1] = { table.concat(buf), cur or vim.NIL } end
  buf = {}
end
for b = 1, #src do
  local c = cap[b] or false
  if c ~= cur then push() cur = c end
  buf[#buf + 1] = src:sub(b, b)
end
push()
io.write(vim.json.encode(spans))
