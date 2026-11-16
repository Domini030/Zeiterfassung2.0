import type { CompanyProfile, Invoice, UnitType } from '../types';

function escapeXml(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mapUnitCode(unit: UnitType): string {
  switch (unit) {
    case 'Std.':
      return 'HUR';
    case 'Tag':
      return 'DAY';
    case 'Pauschal':
      return 'LS';
    case 'Stk.':
    default:
      return 'C62';
  }
}

function cleanSpaces(value: string | undefined): string {
  return (value || '').replace(/\s+/g, '').toUpperCase();
}

export function buildXRechnungXml(invoice: Invoice, company: CompanyProfile): string {
  const isSmallBiz = invoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
  const totalPayable = isSmallBiz ? invoice.netTotal : invoice.grossTotal;
  const taxTotal = isSmallBiz ? 0 : invoice.taxTotal;
  const iban = cleanSpaces(company.iban);
  const bic = cleanSpaces(company.bic);

  // Group tax subtotals by effective rate
  const taxGroups = new Map<number, { taxable: number; tax: number }>();
  for (const item of invoice.lineItems) {
    const rate = isSmallBiz ? 0 : item.taxRate;
    const prev = taxGroups.get(rate) ?? { taxable: 0, tax: 0 };
    taxGroups.set(rate, {
      taxable: Math.round((prev.taxable + item.netTotal) * 100) / 100,
      tax: Math.round((prev.tax + (isSmallBiz ? 0 : item.taxAmount)) * 100) / 100,
    });
  }

  const taxSubtotalsXml = Array.from(taxGroups.entries())
    .map(([rate, grp]) => {
      const catId = isSmallBiz || rate === 0 ? 'E' : 'S';
      const exemptionReason =
        isSmallBiz
          ? `<cbc:TaxExemptionReason>${escapeXml(
              invoice.smallBusinessNotice ||
                company.smallBusinessNotice ||
                'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.'
            )}</cbc:TaxExemptionReason>`
          : rate === 0
            ? '<cbc:TaxExemptionReason>Steuerfreie Leistung (0 %)</cbc:TaxExemptionReason>'
            : '';

      return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${grp.taxable.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${grp.tax.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${catId}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>
        ${exemptionReason}
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    })
    .join('\n');

  const linesXml = invoice.lineItems
    .map((item, idx) => {
      const rate = isSmallBiz ? 0 : item.taxRate;
      const catId = isSmallBiz || rate === 0 ? 'E' : 'S';
      return `  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${mapUnitCode(item.unit)}">${item.quantity.toFixed(2)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${item.netTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${escapeXml(item.detail || item.description)}</cbc:Description>
      <cbc:Name>${escapeXml(item.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${catId}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">${item.unitPriceNet.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('\n');

  const supplierTaxId = company.vatId?.trim() || company.taxNumber?.trim() || '';
  const supplierScheme = company.vatId?.trim() ? 'VAT' : 'FC';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(invoice.issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${escapeXml(invoice.dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${invoice.introText ? `<cbc:Note>${escapeXml(invoice.introText)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXml(invoice.customerSnapshot.companyName)}</cbc:BuyerReference>
  <cac:InvoicePeriod>
    <cbc:StartDate>${escapeXml(invoice.servicePeriodStart)}</cbc:StartDate>
    <cbc:EndDate>${escapeXml(invoice.servicePeriodEnd)}</cbc:EndDate>
  </cac:InvoicePeriod>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${escapeXml(company.email || 'info@taktwerk.local')}</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>${escapeXml(company.companyName || 'TaktWerk')}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(company.street)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(company.city)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(company.postalCode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${
        supplierTaxId
          ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(supplierTaxId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>${supplierScheme}</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ''
      }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(company.companyName || company.ownerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${escapeXml(company.ownerName || company.companyName)}</cbc:Name>
        ${company.phone ? `<cbc:Telephone>${escapeXml(company.phone)}</cbc:Telephone>` : ''}
        ${company.email ? `<cbc:ElectronicMail>${escapeXml(company.email)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${escapeXml(invoice.customerSnapshot.email || 'kunde@local')}</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoice.customerSnapshot.companyName)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(invoice.customerSnapshot.street)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(invoice.customerSnapshot.city)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(invoice.customerSnapshot.postalCode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${
        invoice.customerSnapshot.vatId
          ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(invoice.customerSnapshot.vatId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ''
      }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.customerSnapshot.companyName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${
    iban
      ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${escapeXml(invoice.invoiceNumber)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escapeXml(iban)}</cbc:ID>
      <cbc:Name>${escapeXml(company.companyName || company.ownerName)}</cbc:Name>
      ${
        bic
          ? `<cac:FinancialInstitutionBranch>
        <cbc:ID>${escapeXml(bic)}</cbc:ID>
      </cac:FinancialInstitutionBranch>`
          : ''
      }
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ''
  }
  <cac:PaymentTerms>
    <cbc:Note>${escapeXml(invoice.outroText || `Zahlbar bis ${invoice.dueDate}`)}</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${taxTotal.toFixed(2)}</cbc:TaxAmount>
${taxSubtotalsXml}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${invoice.netTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${invoice.netTotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${totalPayable.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${totalPayable.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${linesXml}
</ubl:Invoice>
`;
}
