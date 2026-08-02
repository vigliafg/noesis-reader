    // --- THEME DEFINITIONS (15 themes grouped by background) ---
    const THEME_COLORS = {
      // White backgrounds
      normal: { bg: '#ffffff', fg: '#000000', label: 'White', group: 'White' },
      softwhite: { bg: '#fafafa', fg: '#1a1a1a', label: 'Soft White', group: 'White' },
      // Cream / Sepia backgrounds
      cream: { bg: '#fdf6e3', fg: '#3b2e1a', label: 'Cream', group: 'Cream / Sepia' },
      sepia: { bg: '#f4ecd8', fg: '#3b2e1a', label: 'Sepia', group: 'Cream / Sepia' },
      parchment: { bg: '#eee5d3', fg: '#33291a', label: 'Parchment', group: 'Cream / Sepia' },
      // Light Gray backgrounds
      gray: { bg: '#e5e7eb', fg: '#1f2937', label: 'Light Gray', group: 'Light Gray' },
      coolgray: { bg: '#dfe3e8', fg: '#1c2530', label: 'Cool Gray', group: 'Light Gray' },
      warmgray: { bg: '#e8e4df', fg: '#2c2419', label: 'Warm Gray', group: 'Light Gray' },
      // Medium Gray backgrounds
      midgray: { bg: '#b0b8c1', fg: '#1a1f26', label: 'Mid Gray', group: 'Medium Gray' },
      slate: { bg: '#94a3b8', fg: '#0f172a', label: 'Slate', group: 'Medium Gray' },
      // Dark Gray backgrounds
      darkgray: { bg: '#4b5563', fg: '#f3f4f6', label: 'Dark Gray', group: 'Dark Gray' },
      charcoal: { bg: '#374151', fg: '#e5e7eb', label: 'Charcoal', group: 'Dark Gray' },
      // Dark / Black backgrounds
      dark: { bg: '#1a1a1a', fg: '#d4d4d4', label: 'Dark', group: 'Dark / Black' },
      midnight: { bg: '#0f1117', fg: '#c8cdd3', label: 'Midnight', group: 'Dark / Black' },
      truedark: { bg: '#000000', fg: '#b8b8b8', label: 'True Black', group: 'Dark / Black' }
    };

    // Build grouped structure for popup rendering
    const THEME_GROUPS = {};
    for (const [key, val] of Object.entries(THEME_COLORS)) {
      if (!THEME_GROUPS[val.group]) THEME_GROUPS[val.group] = [];
      THEME_GROUPS[val.group].push({ key, ...val });
    }

    function applyTheme() {
      if (!rendition) return;

      updateFontInfo();

      const active = THEME_COLORS[currentTheme] || THEME_COLORS.normal;

      rendition.themes.register('custom', {
        body: {
          'background': `${active.bg} !important`,
          'color': `${active.fg} !important`,
          'font-size': `${fontSize}% !important`,
          'line-height': `${lineHeight} !important`
        },
        'p, div, span, li, h1, h2, h3, h4, h5, h6': {
          'font-size': `${fontSize}% !important`,
          'color': `${active.fg} !important`,
          'line-height': `${lineHeight} !important`
        }
      });
      rendition.themes.select('custom');

      // Update active swatch indicator in popup
      updateThemeSwatchActive();
    }

    function updateThemeSwatchActive() {
      const popup = document.getElementById('themePopupMain');
      if (!popup) return;
      popup.querySelectorAll('.theme-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.theme === currentTheme);
      });
    }

    function buildThemePopup() {
      const popup = document.getElementById('themePopupMain');
      if (!popup) return;
      // Keep the h3 heading, clear the rest
      const heading = popup.querySelector('h3');
      popup.innerHTML = '';
      popup.appendChild(heading);

      for (const [groupName, themes] of Object.entries(THEME_GROUPS)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'theme-group';

        const label = document.createElement('div');
        label.className = 'theme-group-label';
        label.textContent = groupName;
        groupDiv.appendChild(label);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'theme-group-items';

        themes.forEach(t => {
          const swatch = document.createElement('div');
          swatch.className = 'theme-swatch' + (t.key === currentTheme ? ' active' : '');
          swatch.dataset.theme = t.key;
          swatch.style.background = t.bg;
          swatch.style.color = t.fg;
          swatch.title = t.label;
          swatch.innerHTML = `<span class="swatch-label">${t.label}</span>`;
          swatch.onclick = (e) => {
            e.stopPropagation();
            currentTheme = t.key;
            applyTheme();
            setStatus(`Theme: ${t.label}`);
          };
          itemsDiv.appendChild(swatch);
        });

        groupDiv.appendChild(itemsDiv);
        popup.appendChild(groupDiv);
      }
    }

