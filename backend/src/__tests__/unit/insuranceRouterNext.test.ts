import { insuranceRouterNextTool } from '../../lib/insurance/flowRouter/routerTool';

describe('insurance.router.next (topic-split manifest routing)', () => {
  test('routes new user to process 01 when nothing is completed', async () => {
    const res = await insuranceRouterNextTool.execute(
      { completed_processes: [] },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_01_welcome_user');
  });

  test('after 01+02 with no coverages and no premises, skips to 21', async () => {
    const res = await insuranceRouterNextTool.execute(
      {
        completed_processes: ['01_welcome_user', '02_intent_segment_and_coverages'],
        has_physical_premises: false,
        ch1_contents_selected: false,
        ch2_building_selected: false,
        ch3a_selected: false,
        ch3b_selected: false,
        ch4_burglary_selected: false,
        ch5_money_selected: false,
        ch6_transit_selected: false,
        ch7_third_party_selected: false,
        ch8_employers_selected: false,
        ch9_product_selected: false,
        ch10_electronic_selected: false,
        cyber_selected: false,
        terror_selected: false,
      },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_21_history_and_disclosures');
  });

  test('if contents selected (and building not selected), routes directly to contents flow (07)', async () => {
    const res = await insuranceRouterNextTool.execute(
      {
        completed_processes: ['01_welcome_user', '02_intent_segment_and_coverages'],
        has_physical_premises: false,
        ch1_contents_selected: true,
      },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_07_property_contents');
  });

  test('if building selected, routes to premises characteristics (03)', async () => {
    const res = await insuranceRouterNextTool.execute(
      {
        completed_processes: ['01_welcome_user', '02_intent_segment_and_coverages'],
        ch2_building_selected: true,
      },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_03_premises_building_characteristics');
  });

  test('if 03 is completed and building is still relevant, routes to 04', async () => {
    const res = await insuranceRouterNextTool.execute(
      {
        completed_processes: [
          '01_welcome_user',
          '02_intent_segment_and_coverages',
          '03_premises_building_characteristics',
        ],
        has_physical_premises: true,
        ch2_building_selected: true,
      },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_04_premises_environment_and_water');
  });

  test('if 03-04 are completed and building is still relevant, routes to 05', async () => {
    const res = await insuranceRouterNextTool.execute(
      {
        completed_processes: [
          '01_welcome_user',
          '02_intent_segment_and_coverages',
          '03_premises_building_characteristics',
          '04_premises_environment_and_water',
        ],
        has_physical_premises: true,
        ch2_building_selected: true,
      },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_05_premises_security_fire_and_burglary');
  });

  test('if 03-05 are completed and building is still relevant, routes to 06', async () => {
    const res = await insuranceRouterNextTool.execute(
      {
        completed_processes: [
          '01_welcome_user',
          '02_intent_segment_and_coverages',
          '03_premises_building_characteristics',
          '04_premises_environment_and_water',
          '05_premises_security_fire_and_burglary',
        ],
        has_physical_premises: true,
        ch2_building_selected: true,
      },
      { conversationId: 'test' },
    );
    expect(res.success).toBe(true);
    expect(res.data?.targetFlowSlug).toBe('flow_06_premises_licenses_and_liens');
  });
});

