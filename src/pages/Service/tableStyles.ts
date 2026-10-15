import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getTableStyles = (theme: GrafanaTheme2) => ({
  scroll: css({
    overflowX: 'auto',
  }),
  table: css({
    borderCollapse: 'collapse',
    width: '100%',
    'th, td': {
      textAlign: 'left',
      verticalAlign: 'top',
      padding: theme.spacing(1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
  }),
});
