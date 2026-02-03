/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Seed: basic insurance carrier (placeholder)
  const carrier = await prisma.insuranceCarrier.upsert({
    where: { slug: 'clal' },
    update: {
      name: 'Clal Insurance',
      contactEmails: ['underwriting@example.com'],
    },
    create: {
      id: 'seed-carrier-clal',
      slug: 'clal',
      name: 'Clal Insurance',
      contactEmails: ['underwriting@example.com'],
      inboundMatch: { subjectIncludes: ['כלל', 'Clal'] },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Seed: demo customer + user link (requires a user; create one if missing)
  const user = await prisma.user.upsert({
    where: { id: 'seed-user-1' },
    update: { role: 'customer' },
    create: {
      id: 'seed-user-1',
      role: 'customer',
      firstName: 'Demo',
      lastName: 'Customer',
      email: 'demo.customer@example.com',
      emailConfirmed: true,
      registered: true,
    },
  });

  const customer = await prisma.customer.upsert({
    where: {
      legalIdType_legalId_country: {
        legalIdType: 'HP',
        legalId: '512345678',
        country: 'IL',
      },
    },
    update: {
      displayName: 'Demo Business Ltd',
      updatedAt: new Date(),
    },
    create: {
      id: 'seed-customer-1',
      displayName: 'Demo Business Ltd',
      legalIdType: 'HP',
      legalId: '512345678',
      country: 'IL',
      industry: 'Retail',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.customerUser.upsert({
    where: {
      customerId_userId: {
        customerId: customer.id,
        userId: user.id,
      },
    },
    update: { accessRole: 'owner' },
    create: {
      customerId: customer.id,
      userId: user.id,
      accessRole: 'owner',
      createdAt: new Date(),
    },
  });

  // Seed: PDF templates (bytes + mapping spec)
  const fs = require('fs');
  const path = require('path');

  const repoRootCandidates = [process.cwd(), path.join(process.cwd(), '..')];
  const repoRoot = repoRootCandidates.find((p) => fs.existsSync(path.join(p, 'forms'))) || process.cwd();

  const readFileOrNull = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  const readJsonOrEmpty = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});

  const smbPdf = readFileOrNull(path.join(repoRoot, 'forms', 'Clal_SMB_ins_form.pdf'));
  const cyberPdf = readFileOrNull(path.join(repoRoot, 'forms', 'Clal_CyberIns_form.pdf'));
  const medPiPdf = readFileOrNull(path.join(repoRoot, 'forms', 'Clal_Med_PI_form.pdf'));

  const smbMapping = readJsonOrEmpty(path.join(repoRoot, 'forms', 'mappings', 'clal_smb_15943_2025-07.mapping.json'));
  const cyberMapping = readJsonOrEmpty(path.join(repoRoot, 'forms', 'mappings', 'clal_cyber.mapping.json'));
  const medPiMapping = readJsonOrEmpty(path.join(repoRoot, 'forms', 'mappings', 'clal_med_pi.mapping.json'));

  if (smbPdf) {
    await prisma.pdfTemplate.upsert({
      where: { carrierId_name_version: { carrierId: carrier.id, name: 'clal_smb_15943', version: 1 } },
      update: { fileBytes: smbPdf, fieldMapping: smbMapping, active: true },
      create: {
        carrierId: carrier.id,
        name: 'clal_smb_15943',
        version: 1,
        fileBytes: smbPdf,
        fieldMapping: smbMapping,
        active: true,
      },
    });
  }

  if (cyberPdf) {
    await prisma.pdfTemplate.upsert({
      where: { carrierId_name_version: { carrierId: carrier.id, name: 'clal_cyber', version: 1 } },
      update: { fileBytes: cyberPdf, fieldMapping: cyberMapping, active: true },
      create: {
        carrierId: carrier.id,
        name: 'clal_cyber',
        version: 1,
        fileBytes: cyberPdf,
        fieldMapping: cyberMapping,
        active: true,
      },
    });
  }

  if (medPiPdf) {
    await prisma.pdfTemplate.upsert({
      where: { carrierId_name_version: { carrierId: carrier.id, name: 'clal_med_pi', version: 1 } },
      update: { fileBytes: medPiPdf, fieldMapping: medPiMapping, active: true },
      create: {
        carrierId: carrier.id,
        name: 'clal_med_pi',
        version: 1,
        fileBytes: medPiPdf,
        fieldMapping: medPiMapping,
        active: true,
      },
    });
  }

  // Create a seed conversation
  const conversation = await prisma.conversation.upsert({
    where: { id: 'seed-conversation-1' },
    update: {},
    create: {
      id: 'seed-conversation-1',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  // Seed: demo insurance case
  await prisma.insuranceCase.upsert({
    where: { id: 'seed-insurance-case-1' },
    update: { status: 'draft', updatedAt: new Date() },
    create: {
      id: 'seed-insurance-case-1',
      customerId: customer.id,
      carrierId: carrier.id,
      status: 'collectingInfo',
      summary: 'Demo insurance case for local development',
      conversationId: conversation.id,
      createdByUserId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create a seed API call record
  await prisma.apiCall.upsert({
    where: { id: 'seed-apicall-1' },
    update: {},
    create: {
      id: 'seed-apicall-1',
      conversationId: conversation.id,
      provider: 'openai',
      operation: 'seed',
      request: { message: 'seed request' },
      response: { result: 'success' },
      status: 200,
      latencyMs: 1
    }
  });

  // Create seed settings if needed
  await prisma.settings.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      currentVersionId: null,
      updatedAt: new Date()
    }
  });

  console.log('✅ Database seeded successfully');
  console.log(`   - Conversation: ${conversation.id}`);
  console.log(`   - API Call: seed-apicall-1`);
  console.log(`   - Settings: global`);
  console.log(`   - Carrier: ${carrier.slug}`);
  console.log(`   - Customer: ${customer.displayName}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
