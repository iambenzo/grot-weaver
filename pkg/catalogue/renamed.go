package catalogue

func (c *Catalogue) RenamedFrom() map[string][]string {
	renamed := map[string][]string{}
	for _, attribute := range c.Registry.Attributes {
		if attribute.Deprecated != nil && attribute.Deprecated.RenamedTo != "" {
			renamed[attribute.Deprecated.RenamedTo] = append(renamed[attribute.Deprecated.RenamedTo], attribute.Name)
		}
	}
	return renamed
}
