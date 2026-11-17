// Every card at every size in CARD_SPEC.md "Sizes", inside the same containers the game uses, so the CSS that sizes them is the real one.

import type { Meta, StoryObj } from '@storybook/react-vite';
import cardsJson from '../../../data/cards.json';
import type { CardsFile } from '../../../src/index.js';
import { Card } from './cards.js';

const cards = cardsJson as unknown as CardsFile;
/** Every card a player can hold or see in play; the support deck (rule card, turn tracker) has no art and no place in a game. */
const ALL_IDS = Object.entries(cards.decks).flatMap(([deck, defs]) => (deck === 'support' ? [] : defs.map((c) => c.id)));
/** A full hand: the most cards a player holds at once. */
const HAND_SIZE = 8;

/** `count` different cards, starting with the one picked in the controls. */
const cardsFrom = (first: string, count: number) => [first, ...ALL_IDS.filter((id) => id !== first)].slice(0, count);

const meta: Meta<typeof Card> = {
  title: 'Cards',
  component: Card,
  args: { id: 'senior_dev' },
  argTypes: { id: { control: 'select', options: ALL_IDS } },
};
export default meta;
type Story = StoryObj<typeof Card>;

/** Full size, as in the spotlight, a popup of one card, and the hover preview. */
export const Full: Story = {
  render: (args) => (
    <div className="spot-cards">
      <div className="spot-card">
        <Card {...args} />
      </div>
    </div>
  ),
};

/** A hand of 8, sized by the same rule as in a game; set combo or metaPoints to see the marks. */
export const Hand: Story = {
  args: { combo: true, metaPoints: 2 },
  render: (args) => (
    <div className="app in-game">
      <div className="hand-cards" style={{ '--n': HAND_SIZE } as React.CSSProperties}>
        {cardsFrom(args.id, HAND_SIZE).map((id) => (
          <Card key={id} {...args} id={id} />
        ))}
      </div>
    </div>
  ),
};

/** A row of 4 cards turned over together, as the reveal and a round's Meta show them. */
export const PopupRow: Story = {
  render: (args) => (
    <div className="spot-cards flip-row">
      {cardsFrom(args.id, 4).map((id) => (
        <div key={id} className="flip-card">
          <div className="flip-inner" style={{ '--flip-ms': '0ms', '--flip-delay': '0ms' } as React.CSSProperties}>
            <div className="flip-front">
              <Card id={id} />
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
};

/** The tile a Crisis in play and the card asking a decision use. */
export const TableTile: Story = {
  args: { id: 'deadline_crunch' },
  render: (args) => (
    <div className="app in-game">
      <div className="goals">
        <Card {...args} />
      </div>
    </div>
  ),
};

/** The round chip in a team row and in a decision's choices. */
export const TeamChip: Story = {
  args: { chip: true },
  render: (args) => (
    <div className="mini-team">
      {cardsFrom(args.id, 6).map((id) => (
        <Card key={id} {...args} id={id} />
      ))}
    </div>
  ),
};

/** Every card side by side at full size, to read them against each other (Card text rules 6 and 12). */
export const AllCards: Story = {
  render: () => (
    <div className="card-gallery">
      {ALL_IDS.map((id) => (
        <Card key={id} id={id} />
      ))}
    </div>
  ),
};
