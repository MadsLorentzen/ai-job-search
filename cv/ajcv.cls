%% ajcv.cls - AJ Magnuson single-column resume class
%% Reproduces the "2026 Growth Lead" resume format.
%% Fonts: Josefin Sans (display) + Carlito (body, Calibri metric-compatible).
%% Compile with: lualatex
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{ajcv}[2026/06/22 AJ Magnuson single-column resume]
\LoadClass[11pt,letterpaper]{article}

\RequirePackage[top=0.7in,bottom=0.6in,left=0.85in,right=0.85in]{geometry}
\RequirePackage{fontspec}
\RequirePackage{xcolor}
\RequirePackage{enumitem}
\RequirePackage{needspace}
\RequirePackage{etoolbox}
\RequirePackage{microtype}
\RequirePackage[hidelinks]{hyperref}
\RequirePackage{xifthen}

\pagestyle{empty}
\setlength{\parindent}{0pt}

% ---------- Colors (monochrome: ink + greys) ----------
\definecolor{ink}{HTML}{1A1A1A}
\definecolor{midgrey}{HTML}{4D4D4D}
\definecolor{grey}{HTML}{808080}

% ---------- Fonts ----------
% Body: Carlito (Calibri metric-compatible). Display: Josefin Sans.
\setmainfont{Carlito}[
  UprightFont = *-Regular,
  BoldFont    = *-Bold,
  ItalicFont  = *-Italic,
  BoldItalicFont = *-BoldItalic ]
\newfontfamily\display{Josefin Sans}[
  UprightFont = *-Regular,
  BoldFont    = *-Bold,
  FontFace    = {mb}{n}{*-Medium},
  FontFace    = {sb}{n}{*-SemiBold},
  FontFace    = {l}{n}{*-Light} ]
\newcommand{\displaymedium}{\display\fontseries{mb}\selectfont}
\newcommand{\displaysemi}{\display\fontseries{sb}\selectfont}

\color{ink}

% ---------- Header: name (left) + contact (right) ----------
% \cvheader{A. J. MAGNUSON}{contact line}
\newcommand{\cvheader}[2]{%
  \begin{minipage}[c]{0.60\textwidth}
    {\display\fontsize{23}{25}\selectfont\bfseries\color{ink}%
     \addfontfeature{LetterSpace=6.0}\MakeUppercase{#1}}%
  \end{minipage}\hfill
  \begin{minipage}[c]{0.39\textwidth}
    \raggedleft{\color{grey}\fontsize{8.7}{12.5}\selectfont #2}%
  \end{minipage}\par
  \vspace{4pt}\textcolor{grey}{\rule{\textwidth}{0.6pt}}\par
}

% ---------- Section label: small tracked grey caps, no rule ----------
\newcommand{\cvsection}[1]{%
  \vspace{9pt}\par
  {\display\fontsize{9}{11}\selectfont\color{grey}%
   \addfontfeature{LetterSpace=10.0}\MakeUppercase{#1}}\par
  \vspace{3pt}%
}

% ---------- Company entry header ----------
% \cventry{COMPANY}{location}{dates}
\newcommand{\cventry}[3]{%
  \needspace{5\baselineskip}\vspace{5pt}\par
  {\display\fontsize{12.5}{14}\selectfont\bfseries\color{ink}\MakeUppercase{#1}}%
  \ifthenelse{\isempty{#2}}{}{\hspace{5pt}{\color{grey}\fontsize{10}{12}\selectfont #2}}%
  \hfill{\color{grey}\fontsize{8.3}{12}\selectfont\addfontfeature{LetterSpace=4.0}\MakeUppercase{#3}}\par
}

% ---------- One-line company descriptor ----------
\newcommand{\cvdescriptor}[1]{%
  {\color{midgrey}\fontsize{9.7}{12.5}\selectfont #1}\par\vspace{1pt}%
}

% ---------- Role title (rounded display accent, indented) ----------
\newcommand{\cvrole}[1]{%
  \vspace{2pt}\par\hspace{0.9em}{\displaymedium\fontsize{11}{13}\selectfont\color{ink}#1}\par\vspace{1pt}%
}

% ---------- Bullet list ----------
\newlist{cvbullets}{itemize}{1}
\setlist[cvbullets]{
  leftmargin=1.9em, labelsep=0.55em, label=\textcolor{midgrey}{\fontsize{6}{6}\selectfont\textbullet},
  topsep=1.5pt, partopsep=0pt, parsep=0pt, itemsep=1.4pt }
\AtBeginEnvironment{cvbullets}{\fontsize{9.8}{12.6}\selectfont}

% summary / plain body paragraph
\newcommand{\cvsummary}[1]{{\fontsize{9.8}{13}\selectfont #1}\par}

% inline middot-separated skills line
\newcommand{\cvskillline}[1]{{\fontsize{9.8}{13.5}\selectfont #1}\par}

\endinput
