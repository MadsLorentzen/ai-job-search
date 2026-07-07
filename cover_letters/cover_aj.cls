%% cover_aj.cls - AJ Magnuson cover letter, matched to ajcv.cls
%% Fonts: Josefin Sans (display) + Carlito (body). Monochrome.
%% Compile with: lualatex (or xelatex)
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{cover_aj}[2026/06/22 AJ Magnuson cover letter]
\LoadClass[11pt,letterpaper]{article}

\RequirePackage[top=0.85in,bottom=0.85in,left=1.0in,right=1.0in]{geometry}
\RequirePackage{fontspec}
\RequirePackage{xcolor}
\RequirePackage{etoolbox}
\RequirePackage{enumitem}
\RequirePackage{microtype}
\RequirePackage[hidelinks]{hyperref}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{8pt}

\definecolor{ink}{HTML}{1A1A1A}
\definecolor{midgrey}{HTML}{4D4D4D}
\definecolor{grey}{HTML}{808080}

\setmainfont{Carlito}[
  UprightFont = *-Regular, BoldFont = *-Bold,
  ItalicFont = *-Italic, BoldItalicFont = *-BoldItalic ]
\newfontfamily\display{Josefin Sans}[
  UprightFont = *-Regular, BoldFont = *-Bold,
  FontFace = {mb}{n}{*-Medium} ]
\newcommand{\displaymedium}{\display\fontseries{mb}\selectfont}

\color{ink}
\linespread{1.05}

% ---------- Header: matches the CV ----------
\newcommand{\coverheader}[2]{%
  \begin{minipage}[c]{0.60\textwidth}
    {\display\fontsize{23}{25}\selectfont\bfseries\color{ink}%
     \addfontfeature{LetterSpace=6.0}\MakeUppercase{#1}}%
  \end{minipage}\hfill
  \begin{minipage}[c]{0.39\textwidth}
    \raggedleft{\color{grey}\fontsize{8.7}{12.5}\selectfont #2}%
  \end{minipage}\par
  \vspace{4pt}\textcolor{grey}{\rule{\textwidth}{0.6pt}}\par
  \vspace{2pt}%
}

% ---------- Right-aligned date ----------
\newcommand{\coverdate}[1]{{\raggedleft\color{grey}\fontsize{10}{13}\selectfont #1\par}}

% ---------- A letter paragraph ----------
\newcommand{\lettercontent}[1]{{\fontsize{11}{15}\selectfont #1\par}}

% ---------- Bullet list (matches CV bullets, sized up) ----------
\newlist{coverbullets}{itemize}{1}
\setlist[coverbullets]{
  leftmargin=1.6em, labelsep=0.5em, label=\textcolor{midgrey}{\fontsize{6}{6}\selectfont\textbullet},
  topsep=2pt, partopsep=0pt, parsep=0pt, itemsep=4pt }
\AtBeginEnvironment{coverbullets}{\fontsize{10.7}{14}\selectfont}

% ---------- Sign-off ----------
\newcommand{\closing}[1]{{\fontsize{11}{15}\selectfont #1\par}}
\newcommand{\signature}[1]{{\displaymedium\fontsize{13}{15}\selectfont\color{ink}#1\par}}

\endinput
